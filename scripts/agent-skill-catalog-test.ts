/// <reference types="node" />
import {
  SKILLS_INJECTED_PER_AGENT,
  SKILL_BODY_MAX_TOKENS,
  SKILL_CATALOG_MAX_TOKENS
} from '../src/shared/agentTopology'
import {
  buildSkillCatalog,
  buildSkillHint,
  clampSkillBody,
  estimateTokens,
  routeSkills,
  scoreSkills,
  type SkillLike
} from '../src/main/agent/skillCatalog'

/**
 * Skill kataloğu ve yönlendirici testleri (saf mantık).
 * Çalıştırma: node scripts/run-unit.cjs scripts/agent-skill-catalog-test.ts
 *
 * Neden: katalog sınırsız büyüyordu ve `skill` aracının açıklaması aynı adları
 * ikinci kez yazıyordu. Gövde yalnızca istek üzerine yüklenmeli ve token
 * bütçesine kırpılmalı.
 */

let failed = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`
  )
}

const skill = (id: string, name: string, description: string, whenToUse?: string): SkillLike => ({
  id,
  name,
  description,
  whenToUse
})

const SKILLS: SkillLike[] = [
  skill('usb-triage', 'USB envanteri triyajı', 'Bağlı USB cihazlarını ve seri portları raporlar', 'Donanım tarama sorularında'),
  skill('git-flow', 'Git akışı', 'Commit, branch ve worktree işlemleri', 'Sürüm kontrolü işlerinde'),
  skill('review-py', 'Python incelemesi', 'Python kodunu inceler ve öneri verir', 'Python dosyaları değiştiğinde'),
  skill('electron-ipc', 'Electron IPC', 'IPC kanalları ve güvenlik doğrulaması', 'Ana süreç ve renderer arası iletişimde')
]

// ============ 1) Token tahmini ============
{
  check('boş metin', estimateTokens(''), 0)
  check('4 karakter = 1 token', estimateTokens('abcd'), 1)
  check('5 karakter = 2 token', estimateTokens('abcde'), 2)
  check('100 karakter', estimateTokens('a'.repeat(100)), 25)
}

// ============ 2) Katalog: boş girdi ============
{
  const result = buildSkillCatalog([])
  check('boş katalog metni', result.text, '')
  check('boş katalog sayısı', result.included, 0)
  check('boş katalog atlanan', result.omitted, 0)
}

// ============ 3) Katalog: hepsi sığar ============
{
  const result = buildSkillCatalog(SKILLS)
  check('dört skill dahil', result.included, 4)
  check('atlanan yok', result.omitted, 0)
  check('başlık var', result.text.includes('Kullanılabilir beceriler'), true)
  check('araç ipucu var', result.text.includes('`skill` aracını'), true)
  check('id biçimi korunuyor', result.text.includes('[usb-triage]'), true)
  check('açıklama korunuyor', result.text.includes('seri portları'), true)
  check('ne zaman dahil', result.text.includes('Donanım tarama'), true)
}

// ============ 4) Katalog: bütçe kısıtı ============
{
  const result = buildSkillCatalog(SKILLS, { maxTokens: 60 })
  check('bütçe ile kısıldı', result.included < 4, true)
  check('atlanan sayıldı', result.omitted > 0, true)
  check('atlanan notu var', result.text.includes('bütçesi nedeniyle listelenmedi'), true)
  check('bütçe aşılmadı', result.tokens <= 60, true)
}

// ============ 5) Katalog: sıfır bütçe ============
{
  const result = buildSkillCatalog(SKILLS, { maxTokens: 1 })
  check('sığmazsa metin boş', result.text, '')
  check('hepsi atlandı', result.omitted, 4)
}

// ============ 6) Katalog: vurgulama ============
{
  const result = buildSkillCatalog(SKILLS, { highlighted: ['git-flow'] })
  check('vurgu işareti var', result.text.includes('[git-flow] (bu göreve uygun)'), true)
  check('vurgusuz skill işaretsiz', result.text.includes('[usb-triage]:'), true)
}

// ============ 7) Puanlama ============
{
  const scored = scoreSkills(SKILLS, 'usb cihazlarını listele')
  check('en yüksek usb skill', scored[0]?.id, 'usb-triage')
  check('puan pozitif', (scored[0]?.score ?? 0) > 0, true)

  const gitScored = scoreSkills(SKILLS, 'commit at ve branch aç')
  check('git sorgusu git skill', gitScored[0]?.id, 'git-flow')
}

// ============ 8) Türkçe normalizasyon ============
{
  // Büyük harf ve Türkçe karakterler eşleşmeli.
  const scored = scoreSkills(SKILLS, 'USB CİHAZLARINI tara')
  check('Türkçe büyük harf eşleşti', scored[0]?.id, 'usb-triage')

  const pythonScored = scoreSkills(SKILLS, 'python dosyasını incele')
  check('python eşleşti', pythonScored[0]?.id, 'review-py')
}

// ============ 9) Yönlendirici ============
{
  const routed = routeSkills(SKILLS, 'usb aygıtlarını ve com portlarını incele')
  check('tek sonuç', routed.length, 1)
  check('doğru skill', routed[0]?.id, 'usb-triage')

  const irrelevant = routeSkills(SKILLS, 'bana bir şiir yaz')
  check('alakasız sorguda seçim yok', irrelevant, [])

  const limited = routeSkills(SKILLS, 'usb git python electron ipc commit branch port', 2)
  check('limit uygulanır', limited.length <= 2, true)
  check('varsayılan limit sabiti', SKILLS_INJECTED_PER_AGENT, 3)
}

// ============ 10) Yönlendirme ipucu ============
{
  check('boş ipucu', buildSkillHint([]), '')
  const hint = buildSkillHint([SKILLS[0] as SkillLike])
  check('ipucu ad içeriyor', hint.includes('USB envanteri triyajı'), true)
  check('ipucu id içeriyor', hint.includes('[usb-triage]'), true)
  check('ipucu yükleme öneriyor', hint.includes('`skill` aracıyla yükle'), true)
}

// ============ 11) Gövde kırpma ============
{
  const short = 'kısa gövde'
  check('kısa gövde değişmez', clampSkillBody(short), short)

  const long = 'x'.repeat(SKILL_BODY_MAX_TOKENS * 4 + 500)
  const clamped = clampSkillBody(long)
  check('uzun gövde kırpıldı', clamped.length < long.length, true)
  check('kırpma notu var', clamped.includes("token'da kesildi"), true)
  check('kırpma sınırı aşılmaz', clamped.length <= SKILL_BODY_MAX_TOKENS * 4 + 200, true)
  check('gövde tavanı sabiti', SKILL_BODY_MAX_TOKENS, 4000)
}

// ============ 12) Katalog tavanı ============
{
  check('katalog tavanı sabiti', SKILL_CATALOG_MAX_TOKENS, 6000)
  // 40 skill'lik gerçekçi katalog tavanı aşmamalı.
  const many: SkillLike[] = Array.from({ length: 40 }, (_, index) =>
    skill(
      `skill-${index}`,
      `Beceri ${index}`,
      'Bu beceri orta uzunlukta bir açıklama taşır ve katalog bütçesini sınar',
      'İlgili görevlerde kullanılır'
    )
  )
  const result = buildSkillCatalog(many)
  check('40 skill tavanı aşmaz', result.tokens <= SKILL_CATALOG_MAX_TOKENS, true)
  check('bir kısmı dahil edildi', result.included > 0, true)
}

// ============ 13) Deterministik ============
{
  const a = buildSkillCatalog(SKILLS, { highlighted: ['git-flow'] })
  const b = buildSkillCatalog(SKILLS, { highlighted: ['git-flow'] })
  check('aynı girdi aynı katalog', a.text, b.text)
  check('puanlama deterministik', JSON.stringify(scoreSkills(SKILLS, 'usb')), JSON.stringify(scoreSkills(SKILLS, 'usb')))
}

console.log(`TOTAL=46 FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
