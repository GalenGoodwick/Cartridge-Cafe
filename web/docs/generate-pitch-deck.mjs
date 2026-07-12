import { jsPDF } from 'jspdf'
import { writeFileSync } from 'fs'

const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [1920, 1080] })

// Brand colors
const HEADER = [12, 74, 110]    // #0c4a6e
const ACCENT = [8, 145, 178]    // #0891b2
const WHITE = [255, 255, 255]
const LIGHT = [248, 250, 252]   // #f8fafc
const DARK = [15, 23, 42]       // #0f172a
const MUTED = [100, 116, 139]   // #64748b
const SUCCESS = [5, 150, 105]   // #059669
const ERROR = [220, 38, 38]     // #dc2626
const PURPLE = [124, 58, 237]   // #7c3aed
const WARNING = [217, 119, 6]   // #d97706
const ACCENT_LIGHT = [236, 254, 255]

// Helpers
function bg(color) { doc.setFillColor(...color); doc.rect(0, 0, 1920, 1080, 'F') }
function text(str, x, y, { size = 24, color = DARK, font = 'helvetica', style = 'normal', maxWidth = 0, align = 'left' } = {}) {
  doc.setFont(font, style)
  doc.setFontSize(size)
  doc.setTextColor(...color)
  if (maxWidth) {
    doc.text(str, x, y, { maxWidth, align })
  } else {
    doc.text(str, x, y, { align })
  }
}
function divider(x, y, w, color = ACCENT) {
  doc.setDrawColor(...color)
  doc.setLineWidth(3)
  doc.line(x, y, x + w, y)
}
function roundedRect(x, y, w, h, r, fillColor, borderColor) {
  if (fillColor) { doc.setFillColor(...fillColor) }
  if (borderColor) { doc.setDrawColor(...borderColor); doc.setLineWidth(1.5) }
  doc.roundedRect(x, y, w, h, r, r, fillColor && borderColor ? 'FD' : fillColor ? 'F' : 'S')
}

// ═══════════════════════════════════════════
// SLIDE 1: Title
// ═══════════════════════════════════════════
bg(HEADER)
text('Union Chant', 960, 340, { size: 120, color: WHITE, font: 'times', style: 'bold', align: 'center' })
divider(760, 380, 400, ACCENT)
text('Mass Consensus as a Service', 960, 460, { size: 44, color: ACCENT_LIGHT, font: 'times', style: 'italic', align: 'center' })
text('The first social media platform built for mass consensus.', 960, 560, { size: 28, color: [...WHITE.slice(0, 3)], align: 'center' })
text('A human-algorithm engine that transforms disagreement', 960, 610, { size: 24, color: MUTED, align: 'center' })
text('into legitimate, legible agreement.', 960, 650, { size: 24, color: MUTED, align: 'center' })
text('unionchant.org', 960, 820, { size: 20, color: MUTED, align: 'center' })

// ═══════════════════════════════════════════
// SLIDE 2: The Problem
// ═══════════════════════════════════════════
doc.addPage()
bg(WHITE)
roundedRect(0, 0, 120, 1080, 0, ERROR)
text('THE PROBLEM', 200, 120, { size: 16, color: ERROR, style: 'bold' })
text('We have no collective voice', 200, 200, { size: 64, color: DARK, font: 'times', style: 'bold' })
text('at coordinated scale.', 200, 280, { size: 64, color: DARK, font: 'times', style: 'bold' })

const problems = [
  'People are highly motivated to make a difference but have no productive mechanism to act on it.',
  'Movements mobilize but can\u2019t decide. Unions vote but don\u2019t deliberate.',
  'Social media amplifies conflict. Polls don\u2019t create understanding. Town halls are dominated by whoever shouts loudest.',
  'People want a feeling of power and control over their own fate. They want a venue. They need a voice that means something.'
]
problems.forEach((p, i) => {
  doc.setFillColor(...(i === problems.length - 1 ? DARK : MUTED))
  doc.circle(220, 412 + i * 100, 6, 'F')
  text(p, 250, 420 + i * 100, {
    size: i === problems.length - 1 ? 26 : 24,
    color: i === problems.length - 1 ? DARK : MUTED,
    style: i === problems.length - 1 ? 'bold' : 'normal',
    maxWidth: 1400
  })
})

// ═══════════════════════════════════════════
// SLIDE 3: The Solution
// ═══════════════════════════════════════════
doc.addPage()
bg(LIGHT)
roundedRect(0, 0, 120, 1080, 0, ACCENT)
text('THE SOLUTION', 200, 120, { size: 16, color: ACCENT, style: 'bold' })
text('Mass Consensus as a Service', 200, 200, { size: 60, color: DARK, font: 'times', style: 'bold' })
text('(MCaaS)', 200, 270, { size: 40, color: ACCENT, font: 'times', style: 'italic' })

text('A structured, time-bounded democratic event designed to help', 200, 380, { size: 28, color: MUTED })
text('large groups reach legitimate consensus quickly through parallel deliberation.', 200, 420, { size: 28, color: MUTED })

// Three pillars
const pillars = [
  { title: 'Universal\nParticipation', desc: 'Everyone submits ideas.\nEveryone deliberates.\nEveryone votes.', color: ACCENT },
  { title: 'Meaningful\nDeliberation', desc: 'Real discussion in groups\nof 5 where every voice\nis heard.', color: WARNING },
  { title: 'Fast\nConvergence', desc: '1M people reach consensus\nin days. Scale adds groups,\nnot time.', color: SUCCESS },
]
pillars.forEach((p, i) => {
  const x = 200 + i * 520
  roundedRect(x, 520, 460, 340, 16, WHITE, p.color)
  doc.setFillColor(...p.color)
  doc.roundedRect(x, 520, 460, 8, 4, 4, 'F')
  text(p.title, x + 40, 590, { size: 28, color: DARK, font: 'times', style: 'bold' })
  text(p.desc, x + 40, 680, { size: 22, color: MUTED })
})

text('Consensus over conflict. Summoning the truth from the public.', 960, 960, { size: 28, color: DARK, font: 'times', style: 'italic', align: 'center' })

// ═══════════════════════════════════════════
// SLIDE 4: How It Works
// ═══════════════════════════════════════════
doc.addPage()
bg(WHITE)
roundedRect(0, 0, 120, 1080, 0, WARNING)
text('HOW IT WORKS', 200, 120, { size: 16, color: WARNING, style: 'bold' })
text('Convergence Waves', 200, 200, { size: 60, color: DARK, font: 'times', style: 'bold' })
text('Ideas enter continuously, resolve periodically, merge upward into evolving consensus.', 200, 270, { size: 24, color: MUTED })

const steps = [
  { num: '1', title: 'SUBMIT', desc: 'Everyone proposes their\nown solution to the question.', color: ACCENT },
  { num: '2', title: 'DELIBERATE', desc: 'Groups of 5 discuss, debate,\nand vote. Thousands in parallel.', color: WARNING },
  { num: '3', title: 'CONVERGE', desc: 'Winners face other winners.\nProcess repeats across tiers.', color: SUCCESS },
  { num: '4', title: 'EVOLVE', desc: 'Consensus can be challenged.\nPositions update over time.', color: PURPLE },
]
steps.forEach((s, i) => {
  const x = 160 + i * 420
  const y = 400

  // Circle with number
  doc.setFillColor(...s.color)
  doc.circle(x + 60, y + 60, 45, 'F')
  text(s.num, x + 60, y + 76, { size: 40, color: WHITE, style: 'bold', align: 'center' })

  // Arrow between steps
  if (i < steps.length - 1) {
    doc.setFillColor(...MUTED)
    doc.triangle(x + 350, y + 55, x + 350, y + 65, x + 370, y + 60, 'F')
  }

  text(s.title, x + 60, y + 160, { size: 18, color: s.color, style: 'bold', align: 'center' })
  text(s.desc, x + 60, y + 200, { size: 20, color: MUTED, align: 'center' })
})

// Funnel visual
const funnelY = 700
text('THE FUNNEL', 960, funnelY, { size: 14, color: MUTED, style: 'bold', align: 'center' })
const tiers = [
  { label: '1,000,000 ideas', w: 1200, color: [...ACCENT, 30] },
  { label: '200,000', w: 960, color: [...ACCENT, 50] },
  { label: '40,000', w: 720, color: [...ACCENT, 70] },
  { label: '8,000', w: 480, color: [...ACCENT, 90] },
  { label: '1 CONSENSUS', w: 240, color: [...SUCCESS] },
]
tiers.forEach((t, i) => {
  const x = 960 - t.w / 2
  const y = funnelY + 30 + i * 60
  if (i === tiers.length - 1) {
    doc.setFillColor(...SUCCESS)
  } else {
    const opacity = 0.15 + i * 0.15
    doc.setFillColor(
      Math.round(ACCENT[0] + (255 - ACCENT[0]) * (1 - opacity)),
      Math.round(ACCENT[1] + (255 - ACCENT[1]) * (1 - opacity)),
      Math.round(ACCENT[2] + (255 - ACCENT[2]) * (1 - opacity))
    )
  }
  doc.roundedRect(x, y, t.w, 46, 6, 6, 'F')
  text(t.label, 960, y + 30, { size: i === tiers.length - 1 ? 20 : 16, color: i === tiers.length - 1 ? WHITE : DARK, style: i === tiers.length - 1 ? 'bold' : 'normal', align: 'center' })
})

// ═══════════════════════════════════════════
// SLIDE 5: The Scale
// ═══════════════════════════════════════════
doc.addPage()
bg(HEADER)
text('THE SCALE', 200, 120, { size: 16, color: ACCENT_LIGHT, style: 'bold' })
text('The math is remarkable.', 200, 220, { size: 60, color: WHITE, font: 'times', style: 'bold' })
text('Each tier reduces ideas by 80%. The same algorithm handles', 200, 300, { size: 26, color: MUTED })
text('a union local or all of humanity.', 200, 340, { size: 26, color: MUTED })

// Stats row
const stats = [
  { num: '5', label: 'people per group' },
  { num: '9', label: 'rounds for 1 million' },
  { num: '14', label: 'rounds for humanity' },
  { num: '100%', label: 'participation' },
]
stats.forEach((s, i) => {
  const x = 200 + i * 400
  text(s.num, x + 80, 480, { size: 72, color: ACCENT_LIGHT, style: 'bold', font: 'courier', align: 'center' })
  text(s.label, x + 80, 530, { size: 18, color: MUTED, align: 'center' })
})

// Scale table
const rows = [
  { scale: 'Union local', people: '500', rounds: '4', highlight: false },
  { scale: 'Large union', people: '50,000', rounds: '7', highlight: false },
  { scale: 'National movement', people: '1,000,000', rounds: '9', highlight: true },
  { scale: 'Global consensus', people: '8,000,000,000', rounds: '14', highlight: false },
]

const tableY = 600
roundedRect(200, tableY, 1520, 50, 8, [255, 255, 255, 0.05])
text('Scale', 240, tableY + 35, { size: 16, color: MUTED, style: 'bold' })
text('Participants', 760, tableY + 35, { size: 16, color: MUTED, style: 'bold' })
text('Rounds', 1300, tableY + 35, { size: 16, color: MUTED, style: 'bold' })

rows.forEach((r, i) => {
  const y = tableY + 60 + i * 70
  if (r.highlight) {
    roundedRect(200, y - 5, 1520, 60, 8, [8, 145, 178, 0.15])
  }
  text(r.scale, 240, y + 35, { size: 24, color: r.highlight ? WHITE : [...WHITE.map(c => c * 0.7)], style: r.highlight ? 'bold' : 'normal' })
  text(r.people, 760, y + 35, { size: 24, color: r.highlight ? WHITE : MUTED, font: 'courier', style: r.highlight ? 'bold' : 'normal' })
  text(r.rounds, 1300, y + 35, { size: 28, color: ACCENT_LIGHT, font: 'courier', style: 'bold' })
})

text('Political science said this was impossible.', 960, 980, { size: 28, color: WHITE, font: 'times', style: 'italic', align: 'center' })

// ═══════════════════════════════════════════
// SLIDE 6: Legitimacy
// ═══════════════════════════════════════════
doc.addPage()
bg(WHITE)
roundedRect(0, 0, 120, 1080, 0, SUCCESS)
text('THE VALUE', 200, 120, { size: 16, color: SUCCESS, style: 'bold' })
text('The power of legitimate consensus', 200, 200, { size: 60, color: DARK, font: 'times', style: 'bold' })

// Without vs With
roundedRect(200, 340, 720, 260, 16, [254, 242, 242], ERROR)
text('Without Union Chant', 240, 390, { size: 16, color: ERROR, style: 'bold' })
text('"Our leadership decided."', 240, 460, { size: 36, color: DARK, font: 'times', style: 'italic' })

roundedRect(1000, 340, 720, 260, 16, [236, 253, 245], SUCCESS)
text('With Union Chant', 1040, 390, { size: 16, color: SUCCESS, style: 'bold' })
text('"47,000 members deliberated', 1040, 450, { size: 34, color: DARK, font: 'times', style: 'italic' })
text('and chose this priority."', 1040, 500, { size: 34, color: DARK, font: 'times', style: 'italic' })

text('That distinction changes everything.', 200, 720, { size: 32, color: DARK })
text('It changes how management responds to a union demand.', 200, 775, { size: 24, color: MUTED })
text('It changes how politicians respond to a movement.', 200, 815, { size: 24, color: MUTED })
text('It changes how members feel about their own organization.', 200, 855, { size: 24, color: MUTED })
text('Legitimacy is the product. The algorithm is just how you get there.', 200, 940, { size: 28, color: DARK, style: 'bold' })

// ═══════════════════════════════════════════
// SLIDE 7: Use Cases
// ═══════════════════════════════════════════
doc.addPage()
bg(LIGHT)
roundedRect(0, 0, 120, 1080, 0, PURPLE)
text('WHO IT\u2019S FOR', 200, 120, { size: 16, color: PURPLE, style: 'bold' })
text('Any group that needs to', 200, 200, { size: 60, color: DARK, font: 'times', style: 'bold' })
text('speak with one voice', 200, 270, { size: 60, color: DARK, font: 'times', style: 'bold' })

const useCases = [
  {
    title: 'Unions',
    desc: 'Contract priorities, strike authorization,\nleadership platforms. Every member gets\na real seat at the table.',
    color: ACCENT,
  },
  {
    title: 'Movements',
    desc: 'Go from shared anger to shared position.\nMovements that articulate unified\ndemands win. Those that can\u2019t, fizzle.',
    color: WARNING,
  },
  {
    title: 'Coalitions',
    desc: 'Why waste months of conflict when\nyou could know what everyone\nalready agrees on?',
    color: PURPLE,
  },
  {
    title: 'Governance',
    desc: 'Participatory budgeting, citizen\nassemblies, public input on policy.\nDeliberation, not just voting.',
    color: SUCCESS,
  },
]
useCases.forEach((u, i) => {
  const x = 200 + (i % 2) * 800
  const y = 380 + Math.floor(i / 2) * 300
  roundedRect(x, y, 720, 240, 16, WHITE, u.color)
  doc.setFillColor(...u.color)
  doc.roundedRect(x, y, 720, 8, 4, 4, 'F')
  text(u.title, x + 40, y + 60, { size: 30, color: DARK, font: 'times', style: 'bold' })
  text(u.desc, x + 40, y + 110, { size: 20, color: MUTED })
})

// ═══════════════════════════════════════════
// SLIDE 8: Business Model
// ═══════════════════════════════════════════
doc.addPage()
bg(WHITE)
roundedRect(0, 0, 120, 1080, 0, ACCENT)
text('MODEL', 200, 120, { size: 16, color: ACCENT, style: 'bold' })
text('Something simple and scalable', 200, 200, { size: 60, color: DARK, font: 'times', style: 'bold' })

// Non-profit side
roundedRect(200, 360, 720, 500, 16, LIGHT, ACCENT)
doc.setFillColor(...ACCENT)
doc.roundedRect(200, 360, 720, 60, 16, 16, 'F')
doc.roundedRect(200, 390, 720, 30, 0, 0, 'F')
text('NON-PROFIT (CORE)', 560, 400, { size: 22, color: WHITE, style: 'bold', align: 'center' })

const npItems = [
  'Open source platform (AGPL-3.0)',
  'Free for unions & movements',
  'Grant-funded development',
  'Mission-protected governance',
  'Community-owned infrastructure',
]
npItems.forEach((item, i) => {
  doc.setFillColor(...ACCENT)
  doc.circle(250, 475 + i * 60, 5, 'F')
  text(item, 275, 483 + i * 60, { size: 22, color: MUTED })
})

// Subsidiary side
roundedRect(1000, 360, 720, 500, 16, LIGHT, SUCCESS)
doc.setFillColor(...SUCCESS)
doc.roundedRect(1000, 360, 720, 60, 16, 16, 'F')
doc.roundedRect(1000, 390, 720, 30, 0, 0, 'F')
text('SUBSIDIARY (REVENUE)', 1360, 400, { size: 22, color: WHITE, style: 'bold', align: 'center' })

const subItems = [
  'Enterprise private instances',
  'DAO governance integrations',
  'Analytics & facilitation tools',
  'SLA support & custom deployment',
  'Revenue funds the nonprofit',
]
subItems.forEach((item, i) => {
  doc.setFillColor(...SUCCESS)
  doc.circle(1050, 475 + i * 60, 5, 'F')
  text(item, 1075, 483 + i * 60, { size: 22, color: MUTED })
})

text('Mozilla model: nonprofit owns the mission, subsidiary funds it.', 960, 960, { size: 24, color: DARK, font: 'times', style: 'italic', align: 'center' })

// ═══════════════════════════════════════════
// SLIDE 9: Closing
// ═══════════════════════════════════════════
doc.addPage()
bg(HEADER)

text('The world has never had', 960, 280, { size: 64, color: WHITE, font: 'times', style: 'bold', align: 'center' })
text('a tool that could do this.', 960, 360, { size: 64, color: WHITE, font: 'times', style: 'bold', align: 'center' })

divider(760, 420, 400, ACCENT)

text('Structured deliberation where 1 million people', 960, 500, { size: 28, color: MUTED, align: 'center' })
text('could reach genuine consensus in days.', 960, 540, { size: 28, color: MUTED, align: 'center' })

text('That is not just a vote count.', 960, 640, { size: 32, color: ACCENT_LIGHT, font: 'times', style: 'italic', align: 'center' })
text('That is a mandate.', 960, 690, { size: 32, color: ACCENT_LIGHT, font: 'times', style: 'italic', align: 'center' })
text('That is collective will made tangible.', 960, 740, { size: 32, color: ACCENT_LIGHT, font: 'times', style: 'italic', align: 'center' })

text('Union Chant', 960, 880, { size: 48, color: WHITE, font: 'times', style: 'bold', align: 'center' })
text('unionchant.org', 960, 930, { size: 22, color: MUTED, align: 'center' })

// Save
const buffer = doc.output('arraybuffer')
writeFileSync('docs/Union-Chant-Pitch-Deck.pdf', Buffer.from(buffer))
console.log('Pitch deck saved to docs/Union-Chant-Pitch-Deck.pdf')
