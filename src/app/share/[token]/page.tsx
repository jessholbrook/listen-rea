import SharedReport from "./shared-report";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <SharedReport token={(await params).token} />;
}
