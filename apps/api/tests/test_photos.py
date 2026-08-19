"""The image pipeline: what it accepts, what it refuses, and what it strips.

Pure logic over a temporary directory, so no fixtures beyond `tmp_path` and the
monkeypatch that points the media root at it.
"""

import io
import zlib
from pathlib import Path

import pytest
from PIL import Image

from matchpoint_api import photos
from matchpoint_api.config import settings

RED = (255, 0, 0)
BLUE = (0, 0, 255)
WHITE = (255, 255, 255)


@pytest.fixture(autouse=True)
def media_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(settings, "media_root", tmp_path)
    return tmp_path


def encode(image: Image.Image, image_format: str, **options: object) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, image_format, **options)
    return buffer.getvalue()


def pixel(image: Image.Image, x: int, y: int) -> tuple[int, ...]:
    """One RGB pixel, narrowed: getpixel is typed for every mode a Pillow image can be."""
    value = image.convert("RGB").getpixel((x, y))
    assert isinstance(value, tuple)
    return value


def solid(size: tuple[int, int] = (300, 300), colour: tuple[int, int, int] = RED) -> Image.Image:
    return Image.new("RGB", size, colour)


def halves(size: tuple[int, int], vertical: bool) -> Image.Image:
    """An image split into a red half and a blue half, to tell orientations apart."""
    image = Image.new("RGB", size, RED)
    width, height = size
    box = (0, height // 2, width, height) if vertical else (width // 2, 0, width, height)
    image.paste(BLUE, box)
    return image


def claiming_size(width: int, height: int) -> bytes:
    """A PNG of a few hundred bytes whose header claims a canvas of `width` x `height`.

    The point of the pixel bound is a small file that decodes huge, so the test builds
    exactly that rather than a genuinely large image, which would prove nothing about
    when the refusal happens.
    """
    data = bytearray(encode(solid((1, 1)), "PNG"))
    # IHDR: 8 bytes of signature, then a 4-byte length and the 4-byte chunk type, so the
    # dimensions start at 16 and the CRC covers the type and data at 12 through 29.
    data[16:24] = width.to_bytes(4, "big") + height.to_bytes(4, "big")
    data[29:33] = zlib.crc32(bytes(data[12:29])).to_bytes(4, "big")
    return bytes(data)


def test_a_jpeg_is_stored_as_a_square_webp(media_root: Path) -> None:
    key = photos.store(encode(solid(), "JPEG"))

    with Image.open(media_root / f"{key}{photos.EXTENSION}") as stored:
        assert stored.format == "WEBP"
        assert stored.size == (photos.SIZE, photos.SIZE)


@pytest.mark.parametrize("image_format", ["JPEG", "PNG", "WEBP"])
def test_every_accepted_format_round_trips(image_format: str, media_root: Path) -> None:
    key = photos.store(encode(solid(), image_format))

    assert (media_root / f"{key}{photos.EXTENSION}").exists()


def test_two_uploads_are_stored_under_different_keys() -> None:
    first = photos.store(encode(solid(), "PNG"))
    second = photos.store(encode(solid(), "PNG"))

    assert first != second


def test_a_file_that_is_not_an_image_is_refused() -> None:
    with pytest.raises(photos.UnusableImage, match=photos.NOT_AN_IMAGE):
        photos.store(b"this is not an image")


def test_an_image_in_an_unlisted_format_is_refused() -> None:
    with pytest.raises(photos.UnusableImage, match=photos.UNSUPPORTED_FORMAT):
        photos.store(encode(solid(), "GIF"))


def test_an_image_claiming_too_many_pixels_is_refused(media_root: Path) -> None:
    side = int(photos.MAX_PIXELS**0.5) + 1

    with pytest.raises(photos.UnusableImage, match="resize it"):
        photos.store(claiming_size(side, side))

    assert list(media_root.iterdir()) == []


def test_an_image_at_the_pixel_bound_is_accepted() -> None:
    """Pins the boundary: the refusal is over the limit, not at it."""
    side = int(photos.MAX_PIXELS**0.5)

    photos.store(encode(solid((side, 1)), "PNG"))


def test_the_stored_photo_carries_no_exif(media_root: Path) -> None:
    """A phone JPEG carries where it was taken; a photo of a player must not."""
    exif = Image.Exif()
    exif[0x0112] = 8
    gps = exif.get_ifd(0x8825)
    gps[1] = "S"
    gps[2] = (33.9, 55.0, 0.0)
    source = encode(solid(), "JPEG", exif=exif)
    assert Image.open(io.BytesIO(source)).getexif().get_ifd(0x8825), "the source must carry GPS"

    key = photos.store(source)

    with Image.open(media_root / f"{key}{photos.EXTENSION}") as stored:
        assert dict(stored.getexif()) == {}


def test_a_rotated_photo_is_uprighted_before_it_is_cropped(media_root: Path) -> None:
    """Orientation 8 displays a portrait source as a landscape: red left, blue right.

    Cropped without the rotation the same source gives red above blue instead, so the
    two halves of the result are what tells whether the tag was honoured.
    """
    exif = Image.Exif()
    exif[0x0112] = 8
    source = encode(halves((100, 200), vertical=True), "JPEG", exif=exif)

    key = photos.store(source)

    with Image.open(media_root / f"{key}{photos.EXTENSION}") as stored:
        left = pixel(stored, photos.SIZE // 4, photos.SIZE // 2)
        right = pixel(stored, photos.SIZE * 3 // 4, photos.SIZE // 2)
    assert left[0] > left[2], "the left of an uprighted photo is its red half"
    assert right[2] > right[0], "the right of an uprighted photo is its blue half"


def test_a_wide_photo_is_centre_cropped_rather_than_squashed(media_root: Path) -> None:
    """A 400x100 source: cropping keeps the middle, squashing would keep both ends."""
    key = photos.store(encode(halves((400, 100), vertical=False), "PNG"))

    with Image.open(media_root / f"{key}{photos.EXTENSION}") as stored:
        assert stored.size == (photos.SIZE, photos.SIZE)
        assert pixel(stored, 2, photos.SIZE // 2)[0] > 200, "the crop starts inside the red half"
        assert pixel(stored, photos.SIZE - 3, photos.SIZE // 2)[2] > 200


def test_transparency_is_flattened_onto_white(media_root: Path) -> None:
    key = photos.store(encode(Image.new("RGBA", (300, 300), (0, 0, 0, 0)), "PNG"))

    with Image.open(media_root / f"{key}{photos.EXTENSION}") as stored:
        assert pixel(stored, photos.SIZE // 2, photos.SIZE // 2) == WHITE


def test_a_palette_image_is_stored_as_colour(media_root: Path) -> None:
    key = photos.store(encode(solid(colour=BLUE).convert("P"), "PNG"))

    with Image.open(media_root / f"{key}{photos.EXTENSION}") as stored:
        assert pixel(stored, photos.SIZE // 2, photos.SIZE // 2)[2] > 200


def test_an_image_pillow_refuses_to_open_at_all_is_refused() -> None:
    """Above its own ceiling Pillow raises before the pixel check below can run."""
    with pytest.raises(photos.UnusableImage, match="resize it"):
        photos.store(claiming_size(30_000, 30_000))


def test_a_truncated_image_is_refused() -> None:
    """The header parses and the pixel data does not, so the failure is inside the fit."""
    whole = encode(halves((400, 400), vertical=True), "PNG")

    with pytest.raises(photos.UnusableImage, match=photos.NOT_AN_IMAGE):
        photos.store(whole[: len(whole) // 2])


def test_nothing_is_written_for_an_image_that_is_refused(media_root: Path) -> None:
    with pytest.raises(photos.UnusableImage):
        photos.store(b"this is not an image")

    assert list(media_root.iterdir()) == []


def test_deleting_a_stored_photo_removes_it(media_root: Path) -> None:
    key = photos.store(encode(solid(), "PNG"))

    photos.delete(key)

    assert list(media_root.iterdir()) == []


def test_deleting_a_photo_that_is_already_gone_is_not_an_error() -> None:
    photos.delete(photos.store(encode(solid(), "PNG")))
    photos.delete("mBKcJ7Yh3QhBOTd3ffVXbw")


def test_deleting_nothing_is_not_an_error() -> None:
    photos.delete(None)


def test_a_key_that_could_escape_the_media_directory_is_refused() -> None:
    with pytest.raises(ValueError, match="not a photo key"):
        photos.path_for("../../etc/passwd")


def test_a_url_is_built_from_a_key() -> None:
    assert photos.url_for("mBKcJ7Yh3QhBOTd3ffVXbw") == "/api/media/mBKcJ7Yh3QhBOTd3ffVXbw.webp"


def test_no_key_is_no_url() -> None:
    assert photos.url_for(None) is None
