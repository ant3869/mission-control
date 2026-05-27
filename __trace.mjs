function normalize(s) { return s.toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim() }
function tokenOverlap(a, b) {
  const ta = new Set(normalize(a).split(' ').filter(w=>w.length>2))
  const tb = new Set(normalize(b).split(' ').filter(w=>w.length>2))
  const union = new Set([...ta,...tb]).size
  if (union===0) return 0
  return [...ta].filter(w=>tb.has(w)).length/union
}
const rejected = 'basic Raspberry Pi dashboard'
const cases = ['sensor display station','Pi monitoring screen','home status display']
console.log('rejected tokens:', [...new Set(normalize(rejected).split(' ').filter(w=>w.length>2))])
for (const c of cases) {
  const score = tokenOverlap(rejected, c)
  console.log(`\n"${c}" Jaccard=${score.toFixed(3)} (>=0.35 → ${score>=0.35?'BLOCKED':'bypassed'})`)
  console.log('  new tokens:', [...new Set(normalize(c).split(' ').filter(w=>w.length>2))])
}
