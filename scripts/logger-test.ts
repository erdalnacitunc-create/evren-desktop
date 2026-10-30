import { app } from 'electron'
import { readFileSync } from 'fs'
import { createLogger, logFilePath, redact } from '../src/main/logger'

/**
 * Günlük maskesi testi.
 * Çalıştırma: derlenmiş betiği electron ile aç (bkz. docs/LOGGING.md).
 * Sırların günlük dosyasına hiç yazılmadığını doğrular.
 */

app.setPath('userData', process.env.EVREN_TEST_DATA as string)

const SECRETS = [
  'sk-proj-AbCdEfGhIjKlMnOpQrStUvWx',
  'ghp_1234567890abcdefghijABCDEFGHIJ',
  'github_pat_11ABCDEFG0abcdefghijklmnop',
  'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
  'evren_ABCdef1234567890'
]

const log = createLogger('logger-test')
const samples = [
  `api=${SECRETS[0]}`,
  `token ${SECRETS[1]} kullanıldı`,
  `pat=${SECRETS[2]}`,
  `Authorization: ${SECRETS[3]}`,
  `{"api_key":"${SECRETS[4]}"}`
]

app.whenReady().then(() => {
  for (const sample of samples) log.info(sample)

  const content = readFileSync(logFilePath(), 'utf8')
  let failed = 0

  for (const secret of SECRETS) {
    const leaked = content.includes(secret)
    if (leaked) failed += 1
    console.log(`${leaked ? 'FAIL' : 'PASS'}  sır günlükte yok: ${secret.slice(0, 12)}…`)
  }

  const masked = samples.map((s) => redact(s))
  const maskOk = masked.every((m, i) => !m.includes(SECRETS[i]))
  if (!maskOk) failed += 1
  console.log(`${maskOk ? 'PASS' : 'FAIL'}  redact() tüm örnekleri maskeledi`)
  console.log(`TOTAL=${SECRETS.length + 1} FAILED=${failed}`)
  app.exit(failed === 0 ? 0 : 1)
})
