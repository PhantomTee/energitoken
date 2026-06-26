import { Redirect } from "expo-router";

/** Entry point. Auth wiring (step 5) will redirect to (tabs) when already logged in. */
export default function Index() {
  return <Redirect href="/login" />;
}
