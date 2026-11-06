import { CallDetailView } from "@/components/call-detail";

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CallDetailView id={id} />;
}
