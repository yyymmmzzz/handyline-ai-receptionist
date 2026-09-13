/**
 * Sample call transcripts for the human-handoff demo.
 *
 * These are realistic phone calls between a customer and Alex (the
 * contractor). Each demonstrates a different scenario where AI
 * summary adds value: routine booking, urgent lead, after-hours call.
 *
 * Timestamps are realistic (call duration 2-6 min).
 */

export interface TranscriptTurn {
  speaker: "AI Receptionist" | "Customer" | "Alex (contractor)";
  time: string; // mm:ss
  text: string;
}

export interface SampleTranscript {
  id: string;
  title: string;
  duration: string;
  callerPhone: string;
  customerName: string;
  issue: string;
  trades: string[];
  turns: TranscriptTurn[];
}

export const SAMPLE_TRANSCRIPTS: SampleTranscript[] = [
  // ============================================
  // Scenario 1: Routine booking
  // ============================================
  {
    id: "sample-1",
    title: "Routine booking — kitchen faucet replacement",
    duration: "3 min 24 sec",
    callerPhone: "+1 (832) 555-0142",
    customerName: "Sarah Johnson",
    issue: "Old kitchen faucet leaking, wants to replace",
    trades: ["plumbing"],
    turns: [
      { speaker: "AI Receptionist", time: "00:00", text: "Handy Works, this is Alex. What's the issue." },
      { speaker: "Customer", time: "00:05", text: "Hi, my kitchen faucet has been leaking for like a week. I'd like to get it replaced." },
      { speaker: "AI Receptionist", time: "00:14", text: "Got it. What zip code are you in." },
      { speaker: "Customer", time: "00:17", text: "77005, Bellaire area." },
      { speaker: "AI Receptionist", time: "00:20", text: "77005, in service. Plumbing runs one-twenty to five hundred. When works — morning or afternoon." },
      { speaker: "Customer", time: "00:28", text: "I actually want to talk to Alex directly. Is he available." },
      { speaker: "AI Receptionist", time: "00:33", text: "One moment, I'll connect you." },
      { speaker: "Alex (contractor)", time: "00:42", text: "Hey, this is Alex." },
      { speaker: "Customer", time: "00:44", text: "Hi Alex, Sarah. We met at the Heights Home Show last month." },
      { speaker: "Alex (contractor)", time: "00:50", text: "Sarah! Yeah, of course. The kitchen faucet, you said." },
      { speaker: "Customer", time: "00:55", text: "Yeah, it's the Moen one I bought. It's leaking from the base. I think I need a new cartridge at minimum, or maybe just replace the whole thing." },
      { speaker: "Alex (contractor)", time: "01:08", text: "Yeah Moen faucets, cartridges run about forty to sixty bucks, plus labor. If it's a higher-end model we should probably just replace the whole thing — about three-fifty to four-fifty installed, depending on the model." },
      { speaker: "Customer", time: "01:25", text: "What model do you recommend? Single handle, pull-down sprayer." },
      { speaker: "Alex (contractor)", time: "01:30", text: "I like the Moen Arbor or the Delta Leland. Both about one-eighty to two-fifty at Home Depot. I can pick one up on the way if you want." },
      { speaker: "Customer", time: "01:42", text: "Yeah that would be great. When can you come." },
      { speaker: "Alex (contractor)", time: "01:45", text: "I'm free this Saturday morning. Nine to noon. I can do nine-thirty if that works." },
      { speaker: "Customer", time: "01:50", text: "Nine-thirty is perfect. My husband will be home too." },
      { speaker: "Alex (contractor)", time: "01:53", text: "Great. What's the address." },
      { speaker: "Customer", time: "01:55", text: "4128 Spruce Street, 77005." },
      { speaker: "Alex (contractor)", time: "01:58", text: "Got it. I'll text you Friday night to confirm." },
      { speaker: "Customer", time: "02:02", text: "Perfect, thank you." },
      { speaker: "Alex (contractor)", time: "02:04", text: "Yep. Anything else." },
      { speaker: "Customer", time: "02:06", text: "No that's it. Thanks Alex." },
      { speaker: "Alex (contractor)", time: "02:08", text: "Take care. Have a good day." },
    ],
  },

  // ============================================
  // Scenario 2: Urgent call (water damage)
  // ============================================
  {
    id: "sample-2",
    title: "Urgent — burst pipe, water damage",
    duration: "2 min 47 sec",
    callerPhone: "+1 (713) 555-0928",
    customerName: "David Martinez",
    issue: "Burst pipe flooding the bathroom",
    trades: ["plumbing", "emergency"],
    turns: [
      { speaker: "AI Receptionist", time: "00:00", text: "Handy Works, this is Alex. What's the issue." },
      { speaker: "Customer", time: "00:04", text: "My pipe under the bathroom sink just burst. Water is everywhere. I don't know what to do." },
      { speaker: "AI Receptionist", time: "00:12", text: "Stay safe. Do you know where your main water shutoff is — usually near the water heater or outside." },
      { speaker: "Customer", time: "00:20", text: "I see it. Outside by the meter." },
      { speaker: "AI Receptionist", time: "00:23", text: "Turn it clockwise until it stops. That'll cut the water. I will certainly call you back within fifteen minutes. Have a good day." },
      { speaker: "AI Receptionist", time: "00:35", text: "Anything else." },
      { speaker: "Customer", time: "00:37", text: "No, just call me back." },
      { speaker: "AI Receptionist", time: "00:39", text: "Take care. Have a good day." },
      { speaker: "Alex (contractor)", time: "01:30", text: "Hey David, this is Alex from Handy Works. Got your message. The water's off, right." },
      { speaker: "Customer", time: "01:35", text: "Yeah, I turned it off outside." },
      { speaker: "Alex (contractor)", time: "01:38", text: "Good. How bad is the water on the floor." },
      { speaker: "Customer", time: "01:41", text: "It's spreading. There's like an inch of water in the bathroom and it's reaching the hallway." },
      { speaker: "Alex (contractor)", time: "01:48", text: "Okay, that's getting into subfloor territory. Can you grab a mop or towels — anything to soak it up before I get there." },
      { speaker: "Customer", time: "01:55", text: "Yeah I'm on it." },
      { speaker: "Alex (contractor)", time: "01:57", text: "I'm twenty minutes out. What's the address." },
      { speaker: "Customer", time: "01:59", text: "5872 Westpark Drive, 77057." },
      { speaker: "Alex (contractor)", time: "02:02", text: "Got it. I'll text you when I'm ten minutes away. Don't use the sink or any water until I get there." },
      { speaker: "Customer", time: "02:08", text: "Okay, thank you." },
      { speaker: "Alex (contractor)", time: "02:10", text: "See you soon." },
      { speaker: "Customer", time: "02:11", text: "Thanks Alex." },
    ],
  },

  // ============================================
  // Scenario 3: Follow-up quote (existing customer)
  // ============================================
  {
    id: "sample-3",
    title: "Quote follow-up — drywall + paint after water damage",
    duration: "4 min 12 sec",
    callerPhone: "+1 (281) 555-0455",
    customerName: "Maria Chen",
    issue: "Drywall and paint quote after pipe burst repair",
    trades: ["drywall", "painting"],
    turns: [
      { speaker: "AI Receptionist", time: "00:00", text: "Handy Works, this is Alex. What's the issue." },
      { speaker: "Customer", time: "00:05", text: "Hi, I'm a returning customer. You guys fixed a pipe at my place three weeks ago. I need a quote for the follow-up work." },
      { speaker: "AI Receptionist", time: "00:14", text: "Got it, what's the work." },
      { speaker: "Customer", time: "00:17", text: "Drywall patch on the bathroom ceiling and a fresh paint on the whole ceiling plus two walls. About nine by ten ceiling." },
      { speaker: "AI Receptionist", time: "00:28", text: "What zip and your name." },
      { speaker: "Customer", time: "00:31", text: "77019, Maria Chen." },
      { speaker: "AI Receptionist", time: "00:34", text: "77019, in service. Drywall runs one-fifty to eight hundred. Painting runs two hundred to fifteen hundred. Want to talk to Alex about an exact quote." },
      { speaker: "Customer", time: "00:48", text: "Yes please." },
      { speaker: "AI Receptionist", time: "00:50", text: "One moment." },
      { speaker: "Alex (contractor)", time: "00:58", text: "Hey Maria." },
      { speaker: "Customer", time: "01:00", text: "Hi Alex. How's the family." },
      { speaker: "Alex (contractor)", time: "01:03", text: "Good, good. So the drywall — is it just a section or the whole ceiling." },
      { speaker: "Customer", time: "01:08", text: "Probably two-thirds of the ceiling had to come down. The other third is okay." },
      { speaker: "Alex (contractor)", time: "01:14", text: "Okay. And the paint — you want the whole ceiling plus the two walls, all the same color as before." },
      { speaker: "Customer", time: "01:20", text: "Yes, same color. I have the original paint can in the garage." },
      { speaker: "Alex (contractor)", time: "01:24", text: "Perfect. For about sixty percent of a nine-by-ten ceiling, plus two walls, drywall patch plus paint — I'd estimate about fourteen hundred to eighteen hundred. Probably two days of work." },
      { speaker: "Customer", time: "01:42", text: "Okay. When can you do it." },
      { speaker: "Alex (contractor)", time: "01:45", text: "I'm booked out for a week and a half. Could do it the week of the 22nd. Monday through Wednesday, or Tuesday through Thursday. Whichever." },
      { speaker: "Customer", time: "01:55", text: "Tuesday through Thursday works." },
      { speaker: "Alex (contractor)", time: "01:58", text: "Okay, I'll pencil you in. I'll send you a confirmation text tomorrow with the exact dates. Do you want me to include materials in the quote or labor only." },
      { speaker: "Customer", time: "02:08", text: "Labor and materials, since I'll have you repaint the whole thing anyway." },
      { speaker: "Alex (contractor)", time: "02:12", text: "Got it. So total estimate sixteen hundred to two thousand." },
      { speaker: "Customer", time: "02:18", text: "Okay that works." },
      { speaker: "Alex (contractor)", time: "02:20", text: "I'll come by Tuesday morning to set up. We'll need to move furniture out — can you handle that." },
      { speaker: "Customer", time: "02:26", text: "Yes, my husband and I will move it." },
      { speaker: "Alex (contractor)", time: "02:28", text: "Perfect. I'll text you tomorrow to confirm. Anything else." },
      { speaker: "Customer", time: "02:32", text: "No, that's it. Thanks Alex." },
      { speaker: "Alex (contractor)", time: "02:35", text: "Take care. Have a good day." },
    ],
  },

  // ============================================
  // Scenario 4: After-hours (AI captures and pings Alex)
  // ============================================
  {
    id: "sample-4",
    title: "After-hours — customer wants callback",
    duration: "1 min 38 sec",
    callerPhone: "+1 (832) 555-0731",
    customerName: "Tom Williams",
    issue: "Garage door opener broken",
    trades: ["general", "handyman"],
    turns: [
      { speaker: "AI Receptionist", time: "00:00", text: "Handy Works, this is Alex. What's the issue." },
      { speaker: "Customer", time: "00:04", text: "Hi, my garage door opener is broken. The door won't close. It's 8pm and I'm worried about security." },
      { speaker: "AI Receptionist", time: "00:15", text: "Got it. Alex isn't available right now. He will certainly call you back first thing tomorrow morning. What's your name and number." },
      { speaker: "Customer", time: "00:24", text: "Tom Williams, 832-555-0731." },
      { speaker: "AI Receptionist", time: "00:28", text: "Got it, Tom. What's your zip." },
      { speaker: "Customer", time: "00:30", text: "77030." },
      { speaker: "AI Receptionist", time: "00:32", text: "77030, in service. Anything else I can help with." },
      { speaker: "Customer", time: "00:36", text: "No, just have Alex call me back." },
      { speaker: "AI Receptionist", time: "00:39", text: "Will do. Take care. Have a good day." },
      { speaker: "Alex (contractor)", time: "00:55", text: "Hey Tom, this is Alex. Got your voicemail. Heard the garage door opener is broken. Want me to swing by first thing?" },
      { speaker: "Customer", time: "01:02", text: "Yeah that'd be great. Anytime tomorrow morning is fine." },
      { speaker: "Alex (contractor)", time: "01:06", text: "I can be there at eight if that works. It's usually a quick fix — twenty minutes for the sensor or remote. Worst case we replace the unit, that'd be about four hundred bucks installed." },
      { speaker: "Customer", time: "01:18", text: "Eight is perfect. See you then." },
      { speaker: "Alex (contractor)", time: "01:20", text: "Yep, see you then." },
      { speaker: "Customer", time: "01:21", text: "Thanks Alex." },
      { speaker: "Alex (contractor)", time: "01:22", text: "Take care. Have a good day." },
    ],
  },
];
