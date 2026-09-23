import { redirect } from 'next/navigation';

type PageProps = { params: Promise<{ worldId: string }> };

export default async function WorldPage(props: PageProps) {
  const { worldId } = await props.params;
  redirect(`/dashboard/worlds/${worldId}/entities`);
}
