// Acquisition call script — parsed into visual phases for the live call guide.
// Chris's PERSONAL "OURS VERSION" script (simplified Eric Cline framework).
// Paste raw text in the UI and it re-parses through this same path.
//
// Format the parser understands:
//   # Phase Title            → starts a new phase   (also supports [Phase Title])
//   > coaching cue            → a muted note attached to the current beat
//   ~ words                   → a HOLD / action beat (amber "go do this")
//   ? Trigger | Response      → an "if they say → you say" branch row on the beat
//   <blank line>              → ends the current beat
//   everything else           → the words to say (teleprompter text)

export interface Branch { trigger: string; response: string; }
export interface ScriptStep {
  id: string;
  say: string;
  coach?: string;
  branches?: Branch[];
  hold?: boolean;
}
export interface ScriptPhase {
  id: string;
  title: string;
  steps: ScriptStep[];
}

export function parseScript(raw: string): ScriptPhase[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const phases: ScriptPhase[] = [];
  let phase: ScriptPhase | null = null;
  let sayLines: string[] = [];
  let coachLines: string[] = [];
  let branches: Branch[] = [];
  let hold = false;

  const flushStep = () => {
    if (sayLines.length === 0 && coachLines.length === 0 && branches.length === 0) return;
    if (!phase) {
      phase = { id: 'p0', title: 'Script', steps: [] };
      phases.push(phase);
    }
    phase.steps.push({
      id: `${phase.id}-s${phase.steps.length}`,
      say: sayLines.join(' ').trim(),
      coach: coachLines.length ? coachLines.join(' ').trim() : undefined,
      branches: branches.length ? branches.slice() : undefined,
      hold: hold || undefined,
    });
    sayLines = [];
    coachLines = [];
    branches = [];
    hold = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Phase header
    const header = line.match(/^#{1,3}\s+(.+)$/) || line.match(/^\[(.+)\]$/);
    if (header) {
      flushStep();
      phase = { id: `p${phases.length}`, title: header[1].trim(), steps: [] };
      phases.push(phase);
      continue;
    }

    if (line === '') { flushStep(); continue; }

    // Coaching cue
    if (line.startsWith('>')) {
      coachLines.push(line.replace(/^>\s?/, ''));
      continue;
    }

    // Branch:  ? Trigger | Response
    const br = line.match(/^\?\s*(.+?)\s*\|\s*(.+)$/);
    if (br) {
      branches.push({ trigger: br[1].trim(), response: br[2].trim() });
      continue;
    }

    // Hold / action beat
    if (line.startsWith('~')) {
      if (sayLines.length || coachLines.length || branches.length) flushStep();
      hold = true;
      sayLines.push(line.replace(/^~\s?/, ''));
      continue;
    }

    // Plain "say" line. If we've already captured a full beat (say + coach or
    // branches) with no blank line, this starts a fresh beat.
    if (sayLines.length && (coachLines.length || branches.length)) flushStep();
    sayLines.push(line);
  }

  flushStep();
  return phases.filter((p) => p.steps.length > 0);
}

// Chris's live-dial script, verbatim from ours-script.pdf.
export const DEFAULT_SCRIPT_RAW = `# Intro
Hey, is this [FIRST NAME]?

Hey [FIRST NAME], this is Chris with [COMPANY] — you filled out a form on our site (or spoke with our agent) about selling the place over on [STREET]. Did I catch you at a bad time?
> Pause — let them answer.

Cool. So the reason for the call — I want to see if your property qualifies for an As-Is offer from us. By the end of this call one of two things happens: I either get you an approval with an offer, or I tell you no and give you the reason why. Sound fair?
> Wait for the yes before you move on.

Quick heads up on how we work — we buy As-Is, we cover all closing costs, and there are no commissions. Cool?

# Motivation Dig
So catch me up — what's going on with the place? What's making you think about selling?
> SHUT UP. Take notes. Let them talk.
? Divorce | Sorry to hear that. What's the timeline — are y'all trying to wrap this up by a certain date?
? Parent passed / inherited | Sorry for your loss. Are you the one handling it, or are there siblings involved?
? Behind on payments | That's stressful. How far behind are you — is there a deadline you're working against?
? Relocating | Where are you headed? When do you need to be out there?
? Vacant / can't maintain | How long has it been sitting? What's it costing you each month to hold it?
? Tired landlord | How long have the tenants been in there? Are they current?

Dig deeper — pick 2 or 3, don't interrogate. How long have you been thinking about selling? What's selling gonna do for you — where does the money go? How long have you lived there / owned it? Is it just you on the deed, or is someone else involved too?
> If the other decision-maker isn't on the call: "When's the last time you two talked about selling? How'd that go?"

# Get the Number
In a perfect world — what were you hoping to walk away with?
> Ask it, then go completely silent.

Ballpark? You gotta have a number in your head.
> Write this number down. This is your ceiling.

# Condition
Before we get into the inside, walk me around the outside. What's the neighborhood like — mostly owners or renters? Anything wrong with the structure, siding, roof, gutters? Anything in the back I can't see — pool, shed?
> Start running comps while they talk.

Okay now walk me through the inside. Is it still original to when it was built? Floors, kitchen, cabinets, counters, appliances? Bathrooms — original or updated?

Anything I haven't asked you that, if you were in my shoes, you'd wanna know? Good or bad?

You looking to leave any belongings behind? Anything you need help with on the move?

# First Hold
~ Alright, everything you've told me I've been putting into our system — it goes to our underwriters, they're running a report on the property right now. Let me put you on a quick hold, I'll be right back.
> Run your comps. Check MaxDispo. Set your MAO.

Hey [NAME], no good or bad news yet — I've got a few more things I forgot to ask: Age of the roof? Age of the water heater? Windows original? Foundation — any cracks, slab or crawl space? Electrical panel updated? Plumbing original? Any liens, or a mortgage still on it — roughly how much left?

What would you still need to figure out before you could actually sell?
> Closer 1 — Risk. Surface anything that could kill the deal, now.

Anybody who'd be even a little upset you're selling?
> Closer 2 — Relationships. Find the hidden decision-maker.

If the underwriter comes back with a number that works — when would you wanna close? Our standard is 30 business days, that work?
> Closer 3 — Time. Lock the timeline.

If we get this approved today — here's how it works: we sign a 2-page agreement in plain English, within 24 hours you get a welcome call from our transaction coordinator, title runs the title, we do a quick walkthrough, then we head to closing and you get paid. That's it.
> Pre-frame the process so nothing surprises them at the close.

# Offer
Last thing the underwriter wanted me to ask: if we get to a number that makes sense for both of us, are you ready to move forward with a purchase agreement today?
> Wait for the yes. If no — find out why before you go a step further.

~ Cool — let me run in the back and see what they came up with. Hang tight.
> Second hold, ~2 minutes. Set your final number.

Congrats [NAME] — your property got approved. This is the [first / only] one they've approved for me [this week / today]. Here's what they came back with: it's As-Is, closing in [THEIR TIMELINE], no commissions, we cover all closing costs.

The approved number is $[XXX,358].
> Use an odd, specific number. Then shut up and let them react.

Totally get it — and I'm actually on your side here. The property's already approved, now it's just about making the numbers work for both of us. Let me put you back on hold and see what I can do. Before I do — where do you need to be to walk away happy? Is that the absolute best you can do so I can tell the underwriter? If they can get to that number — you ready to move forward today?
> They pushed for more. Make them close themselves, then go back to the underwriter and come up little by little. Never live negotiate.

You know what — totally fine. Might be the timing's just not right, or maybe you're better off listing with an agent. We really only work with folks who need it moved fast and clean.
> Take-away — only if they go quiet or cold. Let it sit, then: "…unless you want me to have them take one more look? No pressure either way."

# Close
Alright [NAME], here's what happens next. The underwriter's gonna prep the agreement — it'll come through DocuSign to your email, plain English, super easy. What's the best email for you?
> Send the contract now.

Let's verify real quick — your name spelled [X], property at [ADDRESS], price $[AMOUNT] — all correct?

You got your email pulled up? Cool — the underwriter just sent it. Let's walk through it together.
> Walk through it with them, then get the signature.

Within 24 hours our transaction coordinator calls you. Within 72 hours we send a photographer. We may need access a couple times — pics, a contractor walk-through, maybe our funding partner. You can always call me directly, but usually she'll take it from here.

[NAME] — it was a pleasure. Congrats on closing this chapter.
> Let them hang up first.`;
