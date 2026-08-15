import { Link } from "@tanstack/react-router";

export function Home() {
  return (
    <div>
      <div className="flex justify-between">
        <Link to="/profile">Profile</Link>
        <Link to="/settings">Settings</Link>
      </div>
      <h1>Welcome to Home</h1>
    </div>
  );
}
