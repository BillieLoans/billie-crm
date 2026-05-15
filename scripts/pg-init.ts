import { getPayload } from 'payload'
import config from '../src/payload.config'

async function main() {
  console.log('[pg-init] Initialising Payload — push:true will sync schema')
  const payload = await getPayload({ config })
  console.log('[pg-init] Init complete')
  await payload.db.destroy?.()
  process.exit(0)
}

main().catch((err) => {
  console.error('[pg-init] FAILED', err)
  process.exit(1)
})
