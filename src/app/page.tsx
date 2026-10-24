import Workspace from "./workspace";
import Walkthrough from "./demo/walkthrough";
export default function Home() {
  return process.env.VERCEL &&
    !(process.env.LIBSQL_URL || process.env.TURSO_DATABASE_URL) ? (
    <Walkthrough />
  ) : (
    <Workspace />
  );
}
