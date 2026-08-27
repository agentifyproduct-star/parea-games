/* The session splash.

   The stylesheet has already decided whether a splash is showing, and has
   already guaranteed it will lift on its own after the maximum hold. This file
   exists only to take it away *sooner* than that, once the page behind it is
   actually ready — so a fast connection gets a brief brand moment and a slow one
   gets a covered wait, and neither gets a splash a moment longer than it earned.

   Everything here is therefore optional. If this file never loads, the splash
   still goes, on the CSS backstop, and the page underneath is untouched. That is
   deliberate: a full-screen sheet whose only exit is a script is one failed
   request away from an unusable site. */

(function () {
  const el = document.getElementById('splash');
  if (!el || !document.documentElement.classList.contains('splash-on')) return;

  /* Kept in step with the stylesheet by hand. MAX_MS must not exceed the delay
     on the splash-backstop animation, or the backstop would win the race and
     this file would be doing nothing at all. */
  const MIN_MS = 900;    // never a flash
  const MAX_MS = 1800;   // never a wait
  const FADE_MS = 340;

  const startedAt = Date.now();
  let gone = false;

  function dismiss() {
    if (gone) return;
    gone = true;
    el.classList.add('is-out');
    /* Gone for good once the fade is over, so an invisible sheet is never left
       lying across a page somebody is trying to use.

       Taking the class off <html> rather than setting el.hidden, because the
       rule that shows the splash is `html.splash-on .splash` — more specific
       than the browser's own [hidden] rule, which it would simply outrank. The
       switch that turned the splash on is the one that has to turn it off. */
    setTimeout(function () {
      document.documentElement.classList.remove('splash-on');
    }, FADE_MS + 60);
  }

  /* The page is ready; serve out whatever is left of the minimum first. Timing
     from this script rather than from first paint slightly overstates how long
     the splash has been up, which errs toward showing it a touch longer — the
     safe direction, since the floor is there to stop it flashing. */
  function dismissWhenServed() {
    const shown = Date.now() - startedAt;
    if (shown >= MIN_MS) return dismiss();
    setTimeout(dismiss, MIN_MS - shown);
  }

  if (document.readyState === 'complete') dismissWhenServed();
  else window.addEventListener('load', dismissWhenServed);

  /* The ceiling, raced against the load event. A stalled image must not hold
     the page behind a curtain. */
  setTimeout(dismiss, MAX_MS);
})();
