"""Storing a profile photo, bounded so that uploads cannot fill the disk.

Every upload is decoded and re-encoded at one fixed size, so what a photo costs is a
constant rather than whatever a client chose to send: the disk cost of the feature is
one small file per row that has one. Re-encoding also drops EXIF, which is as much the
point as the size — a phone JPEG carries the coordinates it was taken at, and these are
photos of players, some of them children.

The bound that matters is pixels, not bytes. Request bodies are already capped at 1 MB
twice over (`body_limit.py`, and `infra/prod/Caddyfile`), but a megabyte of JPEG decodes
to whatever its header claims, at around ten bytes a pixel however small the file was.
MAX_PIXELS is read from that header before anything is decoded, and `_slots` bounds how
many decodes hold a buffer at once — against the api container's `mem_limit` in
`infra/prod/compose.yml`, the same budget and the same reasoning as `security.py`'s
Argon2 slots.

A file and a row are not one transaction. Every caller commits the row first and unlinks
the file it replaced afterwards, never the other way round: a crash between the two
strands an orphaned file, costing a few kilobytes and nothing else, where the reverse
order leaves a live row pointing at a photo that is gone.
"""

import io
import os
import re
import secrets
import threading
from pathlib import Path

from PIL import Image, ImageOps
from starlette.responses import Response
from starlette.staticfiles import PathLike, StaticFiles
from starlette.types import Scope

from matchpoint_api.config import settings

# One stored size, square, because every surface that shows a photo shows it in a small
# square avatar. 512 covers those at twice their pixel density, and the crop is centred
# rather than the image squashed.
SIZE = 512
QUALITY = 80
# Transparency flattened onto white: WebP would keep the alpha channel, and a
# transparent pixel renders black in an <img>, which is not what a cleared background
# is meant to look like.
BACKGROUND = "white"

# What Pillow must recognise the upload as, checked off the header before any decoder
# runs. An allowlist rather than a sniff of our own: Pillow's format detection is the
# thing that chooses the decoder, so a separate magic-byte check would be a second
# definition of "is this a JPEG" free to disagree with the one that matters. And it has
# to be an allowlist, because among the plugins it would otherwise reach are EPS and PDF,
# which Pillow opens by shelling out to Ghostscript.
ACCEPTED_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})

# Above a common phone's 12.2 megapixels, with room, so that the bound catches a file
# built to be expensive rather than a coach's actual camera. Measured rather than
# reasoned: a decode peaks at around 10 bytes a pixel, so this bound is ~165 MB, and
# the budget it comes out of is the api container's `mem_limit` in
# `infra/prod/compose.yml` — not the VPS's 2 GB. That distinction decides the failure:
# overshooting a cgroup limit is an OOM kill, and the container is
# `restart: unless-stopped`, so a kill under load is a restart loop.
MAX_PIXELS = 16_000_000

# One at a time, unlike security.py's two. Routes are `def`, so they run on the anyio
# threadpool's 40 workers, and without this the figure above would multiply by 40. It is
# one rather than two because a decode is pure CPU on a single core: a second concurrent
# one finishes no sooner and doubles what is resident. Waiting here holds a worker
# thread, which it would have spent waiting for the core anyway.
_slots = threading.Semaphore(1)

# 128 bits, and the whole of the access control on a stored photo: the files are served
# unauthenticated (`docs/security.md`), so the name is what makes one unreachable to
# anyone the URL was not given to.
_KEY_BYTES = 16
_KEY_SHAPE = re.compile(r"[A-Za-z0-9_-]+")

EXTENSION = ".webp"
# Immutable is true by construction: a new photo is a new key, so no name is ever served
# different bytes. Without it every avatar on a roster page is a revalidation request per
# navigation, and a log line each (logs.py).
CACHE_CONTROL = "public, max-age=31536000, immutable"
# Where main.py mounts the directory, and what a browser asks for. The two differ by the
# /api that Caddy's `handle_path` strips in production and the dev proxy strips locally,
# so URL_PREFIX is the one spelling correct in a browser in either environment — and a
# test client, fronted by neither, fetches MEDIA_PATH instead.
MEDIA_PATH = "/media"
URL_PREFIX = f"/api{MEDIA_PATH}"

NOT_AN_IMAGE = "That file is not an image"
UNSUPPORTED_FORMAT = "Photos must be JPEG, PNG or WebP"
TOO_MANY_PIXELS = "That image has too many pixels — resize it before uploading"


class UnusableImage(Exception):
    """An upload this API will not store, carrying the reason to answer the caller with.

    Its message reaches the client as a 400 `detail`, so it says what to do about it.
    """


def url_for(key: str | None) -> str | None:
    """The browser-facing URL of a stored photo, or None where there is none."""
    return f"{URL_PREFIX}/{key}{EXTENSION}" if key else None


def path_for(key: str) -> Path:
    """Where the photo under `key` is stored.

    The shape check is not about the keys this module mints, which cannot contain a
    separator; it is so that a value read back from a column can never become a path
    outside the media directory.
    """
    if not _KEY_SHAPE.fullmatch(key):
        raise ValueError(f"not a photo key: {key!r}")
    return settings.media_root / f"{key}{EXTENSION}"


def store(data: bytes) -> str:
    """Normalise an uploaded image, write it, and return the key it is stored under.

    Raises `UnusableImage` for anything that is not a photo this API will keep.
    """
    with _slots:
        image = _normalise(data)
        key = secrets.token_urlsafe(_KEY_BYTES)
        target = path_for(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        # Written beside the target and moved onto it, so a crash mid-write cannot leave
        # a truncated file at a key a row is about to point at. Same directory, so the
        # move is a rename rather than a copy.
        staged = target.with_suffix(".part")
        image.save(staged, "WEBP", quality=QUALITY)
        os.replace(staged, target)
        return key


def delete(key: str | None) -> None:
    """Remove a stored photo. Called after the row that referenced it is committed."""
    if key is None:
        return
    path_for(key).unlink(missing_ok=True)


def _normalise(data: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(data))
    except Image.DecompressionBombError as exc:
        # Pillow's own guard, which fires inside open() at a ceiling far above ours, so
        # reaching it can only ever mean the refusal MAX_PIXELS is there to give.
        raise UnusableImage(TOO_MANY_PIXELS) from exc
    except OSError as exc:
        # UnidentifiedImageError is one of these: nothing recognised the bytes at all.
        raise UnusableImage(NOT_AN_IMAGE) from exc
    if image.format not in ACCEPTED_FORMATS:
        raise UnusableImage(UNSUPPORTED_FORMAT)
    # Before anything is decoded: open() has read the header alone, so this refuses a
    # small file claiming a large canvas without ever allocating one.
    if image.width * image.height > MAX_PIXELS:
        raise UnusableImage(TOO_MANY_PIXELS)
    try:
        # Asks the JPEG decoder to scale down as it decodes, which it can do in powers of
        # two off the DCT coefficients. A no-op for the other formats, and it is why a
        # phone photo never approaches the bound above: the buffer that gets allocated is
        # a few times the 512 wanted, not the sensor's twelve megapixels.
        image.draft("RGB", (SIZE, SIZE))
        # Rotate to how the camera meant it to be seen before cropping, or a portrait
        # photo is centre-cropped along the wrong axis. RGBA first so a palette or
        # greyscale source resizes as colour and carries an alpha channel to flatten.
        upright = ImageOps.exif_transpose(image) or image
        fitted = ImageOps.fit(
            upright.convert("RGBA"), (SIZE, SIZE), method=Image.Resampling.LANCZOS
        )
    except OSError as exc:
        # A header that parsed over pixel data that did not: a truncated upload.
        raise UnusableImage(NOT_AN_IMAGE) from exc
    # A new image rather than a convert, both to flatten onto white and because nothing
    # of the source's metadata comes with it: this is where EXIF stops.
    flattened = Image.new("RGB", fitted.size, BACKGROUND)
    flattened.paste(fitted, mask=fitted.getchannel("A"))
    return flattened


class MediaFiles(StaticFiles):
    """Serves the stored photos, and nothing else, straight off disk.

    Unauthenticated: the unguessable key is the whole access control, which is what lets
    a roster page pull thirty avatars without thirty session lookups. `docs/security.md`
    records what that does and does not protect.
    """

    def file_response(
        self,
        full_path: PathLike,
        stat_result: os.stat_result,
        scope: Scope,
        status_code: int = 200,
    ) -> Response:
        response = super().file_response(full_path, stat_result, scope, status_code)
        response.headers["Cache-Control"] = CACHE_CONTROL
        # Every file this mount serves is one we encoded as webp ourselves, so the
        # content type is a fact, not a guess: StaticFiles derives it from the OS's
        # mimetypes database, which doesn't register .webp on every base image.
        response.headers["Content-Type"] = "image/webp"
        return response


def mount_media() -> MediaFiles:
    """The media directory, created if it is not there.

    Created rather than required, because StaticFiles refuses to mount a directory that
    does not exist and a fresh checkout would then fail at create_app().
    """
    settings.media_root.mkdir(parents=True, exist_ok=True)
    return MediaFiles(directory=settings.media_root)
