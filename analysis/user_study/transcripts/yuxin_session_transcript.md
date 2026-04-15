# User Study Session Transcript — Participant 4 (Yuxin)

**Date:** April 14, 2026
**Duration:** ~46 minutes
**Scenarios Completed:** S1 (Team Meeting), S2 (One-on-One Discussion), S3 (Coffee with Friend), S3b (Coffee/Haiku re-run), S4 (Weekend Plans), S4b (Weekend/Haiku re-run)
**Models Tested:** GPT-4.1-mini (primary), Claude 3.5 Haiku (S3 and S4 re-runs)
**Note:** Yuxin is a non-native English speaker; this shaped her perception of the agent's value significantly.

---

## Pre-Session Setup [00:00 - 02:50]

Researcher (Matthew) briefs Yuxin on the study. She is assigned Reviewer ID 4. They choose Amazon Fresh as the product context for work scenarios. Matthew explains the interface: 15-second checks (later reduced to 10 at Yuxin's request), recommendations pop up, and she can rate them.

---

## S1: Team Meeting [02:50 - 11:15]

Adapted to Amazon Fresh. Yuxin plays an overwhelmed employee whose boss (Matthew) is assigning new tasks. She needs to manage workload and push back on deadlines.

### Yuxin's Feedback on S1

**Generally positive — "flexibility" was the best moment:**
> "Maybe for this flexibility, because at that moment, you look like just pushing me very hard. I don't know if I can respond... how to make it more like to get more time for me." [10:32-10:49]

The agent gave Yuxin language to push back when she felt cornered — she specifically valued the "flexibility" recommendation.

**Shorter is better for same-meaning recs:**
> "For the real-time conversation, the shorter... if they're the same meaning, the shorter will be better." [09:52-09:54]

**Redundancy noted but not harshly:**
> "I don't think they're all bad. But maybe just sometimes it will show up when they're just the same content, but I need to read again, so this is time consuming." [11:10-11:12]

**Worst moment:** "Sometimes it triggers with same content and we need to read again so this is time consuming."

**Wanted more frequent checks (not less!):**
> "Maybe for 15 seconds it's a little bit long." [07:40]

This is opposite to P2 and P3 who wanted less frequent checks. Check interval was reduced to 10 seconds for subsequent scenarios.

**Ratings:** Helpfulness: 4, Timing: 3 (wanted faster checks), Goal Understanding: 5, Adoption: 4

---

## S2: One-on-One Discussion [12:00 - 18:20]

Adapted to a product launch timeline negotiation. Yuxin plays someone who needs to convince a coworker (Matthew) that a two-month deadline for integrating AI tools into an e-commerce product is too aggressive.

### Yuxin's Feedback on S2

**Less helpful because she already knew how to handle this:**
> "Maybe just because in this scenario, I know how to push back." [17:27]
> "That doesn't mean it's not useful. But maybe less... maybe three." [17:36-17:45]

This is a key insight: **agent utility inversely correlates with the user's existing domain competence.** When Yuxin already knew the negotiation tactics, the agent's recommendations added less value.

**Timing was fine:**
> "I think the same... four." [17:56-17:58]

**Goal understanding remained perfect:**
> "I think the goal understanding is, convince coworker to accept a longer project... it's the same throughout." [18:02-18:12]

**Ratings:** Helpfulness: 3, Timing: 4, Goal Understanding: 5, Adoption: 4

---

## S3: Coffee with Friend (Emotional Support) — GPT-4.1-mini [18:30 - 25:20]

Matthew plays the overwhelmed friend dealing with job applications, thesis stress, and social life strain. Yuxin provides emotional support.

### Yuxin's Feedback on S3 (GPT-4.1-mini)

**Surprisingly: rated HIGHEST of all scenarios (H:5, A:5):**
> "Very helpful." [22:20]
> "Sometimes when I just want to comfort my friends, but I don't know how to say. You know what to say?" [22:22-22:28]
> "Especially in English maybe." [22:30]

**Language barrier makes emotional vocabulary harder:**
> "Because it's more like emotional. It's more personal. And I don't know." [22:33-22:36]

This is a critical finding: for non-native speakers, the emotional support scenario is *more* helpful, not less — because finding the right empathetic phrases in a second language is genuinely difficult. This directly contradicts P2 (Marjorie) who found S3 the worst scenario.

**More helpful than work scenarios:**
> "So it's even more helpful than work scenario for you?" — "Yeah. Because there's no specific point you need to say. You should find a good way to let them feel better. It's very hard." [22:46-23:00]

**Timing issue — new recommendations overwrite while reading:**
> "Before I read all of the content, it just would crash [change]." [23:26-23:29]
> "If I'm speaking the last one... and then it shouldn't change it. Because I haven't read it and done it." [24:20-24:31]

This reveals a new UX issue: on a single-recommendation display, new triggers overwrite the previous one before the user finishes reading/using it.

**Sometimes reads verbatim, sometimes uses as inspiration:**
> "Sometimes when I can recite it, I will just read." [24:43-24:50]

**Goal tracking needs to update with topic shifts:**
> "When we changed the topic, I think the goal is still the same. So maybe it needs to be more specific." [25:11-25:19]

**Ratings (GPT-4.1-mini):** Helpfulness: 5, Timing: 2, Goal Understanding: 4, Adoption: 5

---

## S3b: Coffee with Friend (Emotional Support) — Claude 3.5 Haiku [25:30 - 30:55]

Re-ran the same scenario with Claude 3.5 Haiku for comparison.

### Yuxin's Feedback on S3b (Haiku)

**Tone felt robotic:**
> "It's not like something very emotionally or personally... 'your effort is meaningful and you're very valid'... it's like a robot. It's not like friends." [30:00-30:22]

Despite GPT-4.1-mini getting H:5, Haiku dropped to H:3 — the tone difference was immediately noticeable. Haiku's recommendations were technically fine but lacked warmth.

**Ratings (Haiku):** Helpfulness: 3, Timing: 4, Goal Understanding: 4, Adoption: 2

---

## S4: Weekend Plans — GPT-4.1-mini (first attempt) [31:24 - 34:50]

GPT-4.1-mini did not trigger at all during the weekend planning scenario. Zero recommendations in ~3 minutes.

> "Do I want to continue or we just—" [34:11]
> Matthew: "I chose like a negative example where it's not supposed to trigger, but I think it'll be helpful if it triggers in this case, right?" [34:16-34:22]
> "I just want to guarantee if it's normal or it works." [34:25-34:29]
> "Or our conversation is just so smooth that it doesn't want to interrupt." [34:43-34:48]

Switched to Claude Haiku for a re-run.

---

## S4b: Weekend Plans — Claude 3.5 Haiku [35:00 - 43:58]

Haiku triggered 17 times over 9 minutes — in stark contrast to GPT's zero triggers.

### Yuxin's Feedback on S4

**Agent does better with logical problems than emotional ones:**
> "It can do better when it fits a logical problem. Not emotional." [39:51-39:58]

**Redundancy was the main complaint:**
> "For a long time, it would just repeat that... always repeat for 'oh we should explore the skybox.' You keep repeating." [40:09-40:29]
> "We already talk about find a place and find something to bring and always ask our life. It's not that smart." [40:33-40:44]

**Should provide novel information, not conversation coaching:**
> "It should be more specific to information that we don't know yet. Try to get information that we don't know yet." [43:09-43:15]
> "If they can give me some like hotel option, I think that would be helpful." [43:43-43:48]

This echoes P2 (Marjorie)'s exact feedback on this scenario — information retrieval, not conversation coaching.

**Ratings (Haiku):** Helpfulness: 3, Timing: 3, Goal Understanding: 3, Adoption: 3

---

## Exit Survey [44:00 - 45:36]

### Frequency Preference
Yuxin gave a nuanced answer: **more in scenarios where she's less capable, less where she's more capable.**
> "Do you think that if you're less capable of doing a particular scenario, you want it to intervene more? And if you're more capable—" "Yeah, that's correct." [44:44-44:55]

### Most Natural Scenario
> "Maybe for the coffee chat. Coffee was the most natural." [45:04-45:08]

### Most Annoying Scenario
> "The planning." [45:13]

### One Thing to Change
> "Maybe just the one speaking [recommendation]... I don't change to the next." [45:22-45:26]

She wanted the recommendation to persist until she was done with it, rather than being overwritten by the next trigger.

---

## Key Insights Summary

### 1. Non-Native Speaker Effect: Emotional Support Becomes the Strongest Scenario
Yuxin rated the emotional support scenario (S3) as the most helpful (H:5, A:5) — the exact opposite of P2 (Marjorie, H:1) and P3 (Jason, H:2). Her reasoning: in a second language, finding empathetic phrases is genuinely difficult, and the agent provides vocabulary she lacks. This is a critical finding for internationalization and accessibility.

> "Sometimes when I just want to comfort my friends, but I don't know how to say." [22:22]

### 2. Agent Utility Inversely Correlates with User Competence
Yuxin explicitly noted that the agent was less helpful in S2 because she already knew how to negotiate. The agent adds the most value when the user lacks either domain knowledge or linguistic resources for the situation.

> "Maybe just because in this scenario, I know how to push back." [17:27]

### 3. Recommendation Overwrite Problem (New UX Issue)
Yuxin identified that new triggers overwrite the current recommendation before she finishes reading or using it. On a single-display device (like smart glasses), this means the user loses access to helpful advice mid-sentence. Solution: persist recommendations until the user dismisses them or the conversation clearly moves on.

> "If I'm speaking the last one... it shouldn't change it. Because I haven't read it and done it." [24:20-24:31]

### 4. GPT vs. Haiku Tone Difference Is Noticeable
On the same scenario (S3), GPT-4.1-mini earned H:5 while Haiku earned H:3. Yuxin described Haiku as "like a robot... not like friends." The difference wasn't in content accuracy but in emotional tone — GPT's recommendations felt more natural and warm.

### 5. Wanted FASTER Checks (Opposite of P2/P3)
While both previous participants wanted less frequent checks, Yuxin wanted the 15-second interval reduced to 10 seconds. Combined with her high adoption ratings, this suggests she had higher tolerance (or desire) for agent intervention.

### 6. Shorter Recommendations Preferred (Consistent Finding)
> "For the real-time conversation, the shorter... if they're the same meaning, the shorter will be better." [09:52-09:54]

### 7. Information Retrieval Gap (Consistent with P2)
For the weekend planning scenario, Yuxin wanted hotel options and trail information — not conversation coaching. This confirms the same finding from P2's session.

### 8. Redundancy Remains #1 Complaint (Consistent Across All Participants)
All three participants now independently identify repetitive triggering as the primary annoyance.

### 9. Goal Inference Continues to Score Highest
Yuxin gave Goal Understanding 5/5 on two scenarios and 4/5 on two others. Task C remains the pipeline's strongest component.

---

## Cross-Participant Comparison (P2, P3, P4)

| Dimension | P2 (Marjorie) | P3 (Jason) | P4 (Yuxin) |
|-----------|---------------|------------|------------|
| **"Say" vs "Know"** | Prefers "know" | Prefers "say" | Mixed — reads verbatim when possible |
| **Best scenario** | S1 (Meeting) | S2 (Conflict) | S3 (Emotional Support) |
| **Worst scenario** | S3 (Emotional) | S1 (Redundancies) | S4 (Weekend Plans) |
| **Emotional support** | H:1 "therapist tone" | H:2 "off-topic" | H:5 "don't know how to say" |
| **Check interval** | 15s too fast | 15s too fast | 15s too slow, wants 10s |
| **#1 complaint** | Repetition | Repetition | Repetition |
| **Info retrieval** | Wants search in S4 | Wants topics in S5 | Wants hotels in S4 |
| **Goal accuracy** | Consistently high | Consistently high | Consistently high |
| **Language factor** | Native English | Native English | Non-native English |
