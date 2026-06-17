import SignClient from './sign-client'

export const dynamic = 'force-dynamic'

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <SignClient token={token} />
}
