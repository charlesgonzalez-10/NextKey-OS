import DashboardLayout from '../../layout-dashboard'
import SessionDetailClient from './session-detail-client'

type Props = { params: Promise<{ id: string }> }

export default async function SessionDetailPage({ params }: Props) {
  const { id } = await params
  return (
    <DashboardLayout>
      <SessionDetailClient sessionId={id} />
    </DashboardLayout>
  )
}
