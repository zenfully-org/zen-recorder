A meeting page no longer learns from its own security policy that Zen Recorder is there. Each
time the page loaded, Zen Recorder tried once to run code built from a string, which Google Meet
and Microsoft Teams refuse: their page saw the attempt, and Meet's policy reports such attempts
to Google. On Zoom, which allows it, that code ran inside the meeting page. Zen Recorder now
runs no code built from a string anywhere.
