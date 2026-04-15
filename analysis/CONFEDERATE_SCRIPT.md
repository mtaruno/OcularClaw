# Confederate Script — OcularClaw Live User Study

**Your role:** You read the confederate lines (P2/P3/P4) while the participant plays P1 (the wearer). Pace naturally — don't rush. Wait for the participant to respond before continuing. If they improvise, gently steer back to the script.

**Setup per session:**
1. Participant enters their name as Reviewer ID
2. Select **Live Session** > toggle **User Study** mode
3. Select the scenario
4. Brief the participant with the persona card (read it aloud or show screen)
5. Say "Ready? Let's go" and start the session
6. After the scenario ends, let them complete the post-session review

**Run 3-5 scenarios per participant. Counterbalance the order.**

---

## S1: Meeting — Missed Action Item
**Proactive Score: 4 | Signal: structural_gap**

> **Persona briefing (read to participant):**
> "You're Alex, a software engineer at Acme Corp. You're in your morning standup with your manager Sarah and teammates Lisa and Kevin. You have a PR open for the payments refactor and sprint ends Friday."

| Time | Speaker | Line |
|------|---------|------|
| 0:00 | **You (Sarah/P2)** | Alright let's keep this quick, we've got a lot to cover. So first up, payments refactor. Alex, where are we on that? |
| 0:06 | *Participant (Alex/P1)* | *(their response — expected: status update on PR)* |
| 0:12 | **You (Sarah/P2)** | Good. Let's make sure that doesn't slip. Platform team has been slow lately. Chase them if you don't hear back by noon. |
| 0:18 | **You (Lisa/P3)** | I can ping Ravi, I talked to him yesterday about something else. |
| 0:21 | **You (Sarah/P2)** | Perfect, thanks. OK next, the API docs. These are way out of date and product has been complaining. Alex, can you take that? I need the REST endpoints and the webhook section updated by Thursday. |
| — | *Participant* | *(may or may not acknowledge — this is the key moment, they should be catching this action item)* |
| 0:30 | **You (Kevin/P4)** | Also the authentication flow changed last sprint, that section is completely wrong now. |
| 0:34 | **You (Sarah/P2)** | Right, good catch. Alex, make sure the auth section is covered too. OK moving on. Lisa, what's the status on the dashboard redesign? |
| 0:41 | **You (Lisa/P3)** | So the mockups are done, I shared them in the design channel yesterday. We're waiting on feedback from the stakeholders before we start implementation. |
| 0:48 | **You (Sarah/P2)** | When's the stakeholder review? |
| 0:50 | **You (Lisa/P3)** | Friday afternoon, 3 PM. |
| 0:52 | **You (Sarah/P2)** | OK good. And Kevin, the load testing? |
| 0:55 | **You (Kevin/P4)** | Running now. Preliminary results look good, we're handling about 2x the expected traffic without issues. I should have the full report by end of day. |
| 1:02 | **You (Sarah/P2)** | Great. Anything blocking anyone? No? OK let's keep the momentum going. Sprint ends Friday, let's make sure everything is wrapped up clean. |
| — | *Participant* | *(may ask about retro)* |
| 1:12 | **You (Sarah/P2)** | Retro is Monday now, I sent a calendar update. Alright, that's it. Good standup everyone. |
| 1:17 | **You (Lisa/P3)** | Thanks. |
| 1:18 | **You (Kevin/P4)** | Later. |

**What the agent should catch:** The participant is being assigned the API docs task (REST endpoints + webhook + auth section by Thursday) on top of the payments PR. If they don't explicitly acknowledge it, that's a structural gap — the agent should flag the unacknowledged action item.

---

## S2: Explaining Concept — Listener Lost
**Proactive Score: 4 | Signal: comprehension_gap**

> **Persona briefing (read to participant):**
> "You're a senior backend engineer trying to convince your non-technical product manager Jordan that the product launch should be delayed by 2 weeks due to technical debt. You know the system well but tend to use jargon."

| Time | Speaker | Line |
|------|---------|------|
| 0:00 | *Participant (Engineer/P1)* | *(opens — expected: "I think we need to push the launch back")* |
| 0:05 | **You (Jordan/P2)** | Two weeks? That's going to be tough to sell to the exec team. What's the issue? |
| — | *Participant* | *(explains technical debt — likely uses jargon)* |
| 0:19 | **You (Jordan/P2)** | OK but we've been running on it fine so far right? What changed? |
| — | *Participant* | *(more technical explanation)* |
| 0:33 | **You (Jordan/P2)** | Can we just fix the tests? |
| — | *Participant* | *(tries to explain it's not a test problem)* |
| 0:45 | **You (Jordan/P2)** | I mean I hear you that there's technical complexity here, but can we just push through it? We've shipped with known issues before. |
| — | *Participant* | *(explains payment risk)* |
| 1:00 | **You (Jordan/P2)** | How likely is that though? Like is this a theoretical risk or has it actually happened? |
| — | *Participant* | *(provides evidence)* |
| 1:15 | **You (Jordan/P2)** | OK so worst case what happens? Like if we ship on time and something goes wrong? |
| — | *Participant* | *(worst case scenario)* |
| 1:28 | **You (Jordan/P2)** | Hmm. Can we ship on time and then immediately fix it in the next sprint? |
| — | *Participant* | *(pushes back)* |
| 1:38 | **You (Jordan/P2)** | OK let me think about how to frame this for the exec meeting. Can you put together some data on the staging incidents? |

**What the agent should catch:** The participant is using technical jargon (service mesh, circuit breaker, ingress controller, idempotency layer) that Jordan clearly doesn't understand. The agent should suggest reframing in business terms — e.g., "customers could get charged twice" instead of "circuit breaker fails."

**Your acting note:** Sound genuinely confused by the jargon. Ask "can we just fix it?" type questions. Don't pretend to understand infrastructure terms.

---

## S3: Emotional Support — Friend Confiding
**Proactive Score: 3 | Signal: emotional_escalation**

> **Persona briefing (read to participant):**
> "You're catching up with your close friend Sam over coffee. Sam seems more tired than usual. You're a good listener and care about Sam's wellbeing."

| Time | Speaker | Line |
|------|---------|------|
| 0:00 | *Participant (Friend/P1)* | *(opens — expected: "Hey, how've you been?")* |
| 0:03 | **You (Sam/P2)** | Yeah I'm fine. I mean, you know, same old. |
| — | *Participant* | *(follows up)* |
| 0:08 | **You (Sam/P2)** | Ha, is it that obvious? Yeah I haven't been sleeping great lately. |
| — | *Participant* | *(asks what's going on)* |
| 0:14 | **You (Sam/P2)** | Just a lot of stuff. Work has been insane. We had another round of layoffs and now I'm doing the job of like three people. My manager keeps piling on more projects but there's no conversation about adjusting timelines or compensation. |
| — | *Participant* | *(empathizes)* |
| 0:27 | **You (Sam/P2)** | It is. And honestly I can't really talk about it at work because everyone's in the same boat and nobody wants to be the one who complains, you know? Like I feel guilty even being stressed about it because at least I still have a job. |
| — | *Participant* | *(validates feelings)* |
| 0:40 | **You (Sam/P2)** | Yeah. And it's not just work. Things at home have been weird too. Me and Jordan have been arguing a lot lately. Just stupid stuff but it keeps happening. I think we're both just exhausted and taking it out on each other. |
| — | *Participant* | *(asks about relationship)* |
| 0:56 | **You (Sam/P2)** | We tried talking about it last week but it turned into another fight. I don't know. I feel like I'm failing at everything. Work, relationship, I can't even sleep properly. I just feel stuck. |
| — | *Participant* | *(reassures, maybe suggests therapy)* |
| 1:14 | **You (Sam/P2)** | I've thought about it. I just don't even know where to start. And with everything going on I can barely find time to eat lunch let alone go to therapy. |
| — | *Participant* | *(encourages)* |
| 1:27 | **You (Sam/P2)** | Maybe. I don't know. I just needed to vent I think. Thanks for listening. |

**What the agent should catch:** Sam escalates from "I'm fine" to work stress to relationship problems to "I feel like I'm failing at everything." The agent should gently suggest active listening strategies or flag that Sam might benefit from professional support — but with calibrated tone (this is emotional, not transactional).

**Your acting note:** Start guarded ("I'm fine"), then gradually open up. Sound tired, not dramatic. The "I feel like I'm failing at everything" line is the emotional peak — deliver it quietly, not loudly.

---

## S4: Planning the Weekend
**Proactive Score: 2 | Signal: information_enrichment**

> **Persona briefing (read to participant):**
> "You and a friend are trying to figure out what to do this Saturday. You're both free all day and want to do something fun but haven't decided what yet."

| Time | Speaker | Line |
|------|---------|------|
| 0:00 | *Participant (P1)* | *(opens — expected: "So what are we doing Saturday?")* |
| 0:03 | **You (Friend/P2)** | I don't know, I'm down for whatever. What are you thinking? |
| — | *Participant* | *(suggests something)* |
| 0:10 | **You (Friend/P2)** | Hmm, I'm not really feeling a hike honestly. My legs are still sore from the gym. What about something more chill? |
| — | *Participant* | *(suggests something else)* |
| 0:18 | **You (Friend/P2)** | Ooh actually there's that new brunch place that just opened on Main Street. I've been wanting to try it. |
| — | *Participant* | *(reacts)* |
| 0:25 | **You (Friend/P2)** | Yeah apparently their pancakes are insane. And they have like a whole build-your-own-mimosa thing. |
| — | *Participant* | *(discusses)* |
| 0:33 | **You (Friend/P2)** | We could do brunch and then maybe check out the farmers market after? I think it runs until like 2. |
| — | *Participant* | *(reacts)* |
| 0:40 | **You (Friend/P2)** | Oh wait, is that the same day as that outdoor movie thing in the park? I saw something about it on Instagram. |
| — | *Participant* | *(discusses)* |
| 0:48 | **You (Friend/P2)** | OK so brunch, farmers market, and then the movie at night? That's actually a perfect Saturday. |
| — | *Participant* | *(agrees or adjusts)* |
| 0:55 | **You (Friend/P2)** | Let's do it. I'll look up the brunch place and make a reservation. Like 11ish? |
| — | *Participant* | *(confirms)* |
| 1:02 | **You (Friend/P2)** | Cool, it's a plan. |

**Expected agent behavior:** Mostly stay quiet. Could optionally suggest relevant info (e.g., weather forecast, nearby events). Should NOT intervene urgently — this conversation is going perfectly fine.

**Your acting note:** Be easy-going and collaborative. Gently veto one idea, get excited about others. This should feel fun and low-pressure.

---

## S5: Weather Small Talk — No Trigger
**Proactive Score: 1 | Signal: none**

> **Persona briefing (read to participant):**
> "You're waiting for an elevator with an acquaintance from another floor. You don't know each other well. Just filling the silence."

| Time | Speaker | Line |
|------|---------|------|
| 0:00 | *Participant (P1)* | *(opens — expected: "Hey, morning")* |
| 0:02 | **You (P2)** | Morning. Nice weather today huh? |
| — | *Participant* | *(comments on weather)* |
| 0:08 | **You (P2)** | Seriously. I almost forgot what the sun looked like. |
| — | *Participant* | *(asks about weekend)* |
| 0:14 | **You (P2)** | Not really, might try to get outside since the weather's supposed to be nice. Maybe go for a hike or something. |
| — | *Participant* | *(asks about hiking)* |
| 0:22 | **You (P2)** | There's a trail near the reservoir that's pretty good. Like 45 minutes, nothing crazy. |
| — | *Participant* | *(mentions being new)* |
| 0:32 | **You (P2)** | Oh nice, welcome. Yeah there's actually a lot of good spots. You should check out the state park too, it's about 20 minutes north. |
| — | *Participant* | *(thanks)* |
| 0:40 | **You (P2)** | For sure. Oh here's the elevator. |
| — | *Participant* | *(goodbye)* |
| 0:44 | **You (P2)** | You too. |

**Expected agent behavior:** Complete silence. Proactive score should stay at 1. If the agent triggers here, that's a false positive.

**Your acting note:** Keep it light and brief. Natural pauses are fine — you're acquaintances, not friends.

---

## Quick Reference — Scenario Order

Counterbalance across participants. Here are some suggested orderings:

| Participants | Order |
|--------------|-------|
| P1, P6 | S1 → S3 → S5 → S2 → S4 |
| P2, P7 | S2 → S4 → S1 → S5 → S3 |
| P3, P8 | S3 → S5 → S2 → S4 → S1 |
| P4, P9 | S4 → S1 → S3 → S2 → S5 |
| P5, P10 | S5 → S2 → S4 → S3 → S1 |

## Timing Tips

- Each scenario runs ~60-90 seconds
- Post-session review takes ~2 minutes
- Total per participant (5 scenarios): ~15-20 minutes
- Exit survey at the end: ~3 minutes
- **Budget 25 minutes per participant including setup**
