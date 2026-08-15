import { Link } from "@tanstack/react-router";

export function BottomNav() {
  return (
    <nav>
      <Link to="/home" activeProps={{ "aria-current": "page" }}>
        Home
      </Link>
      <Link to="/players" activeProps={{ "aria-current": "page" }}>
        Players
      </Link>
      <Link to="/matches" activeProps={{ "aria-current": "page" }}>
        Matches
      </Link>
      <Link to="/stats" activeProps={{ "aria-current": "page" }}>
        Stats
      </Link>
    </nav>
  );
}
