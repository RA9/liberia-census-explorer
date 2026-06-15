// Contact form. There is no backend, so "send" composes a mailto: link and
// hands off to the visitor's own email client — the site never transmits or
// stores anything.

const $ = (id) => document.getElementById(id);

export async function wireContactForm(to) {
  await Promise.all(
    ["tc-input", "tc-textarea", "tc-button"].map((t) => customElements.whenDefined(t)),
  );
  const form = $("contactForm");
  const note = $("formNote");
  if (!form) return;

  function show(msg, kind) {
    if (!note) return;
    note.textContent = msg;
    note.className = `form-note ${kind}`;
    note.hidden = false;
  }

  const submit = () => {
    const name = ($("cName")?.value || "").trim();
    const email = ($("cEmail")?.value || "").trim();
    const msg = ($("cMsg")?.value || "").trim();

    if (!name || !email || !msg) {
      show("Please fill in your name, email and message.", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      show("That email address doesn't look right.", "error");
      return;
    }

    const subject = `Census Explorer — message from ${name}`;
    const body = `${msg}\n\n— ${name} (${email})`;
    const href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    show("Opening your email app… if nothing happens, email " + to + " directly.", "ok");
  };

  // tc-button type="submit" fires a cancelable tc-submit and calls
  // form.requestSubmit(); catch the native submit so we don't reload.
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  $("cSend")?.addEventListener("tc-submit", (e) => {
    e.preventDefault();
    submit();
  });
}
