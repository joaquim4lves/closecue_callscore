import { PlaybookEditor } from "@/components/playbook-editor";

export default async function PlaybookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaybookEditor id={id} />;
}
