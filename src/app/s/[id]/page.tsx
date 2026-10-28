import Participant from "./participant";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Participant id={(await params).id} />;
}
