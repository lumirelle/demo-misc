/* Reusable self-check quiz widget.
   Usage: place a <script type="application/json" class="quiz-data">…</script> tag
   anywhere; this script renders a quiz immediately after it. Immediate feedback,
   one attempt per question. */
(function () {
  "use strict";

  function renderQuiz(script) {
    let items;
    try { items = JSON.parse(script.textContent); } catch (e) { return; }
    if (!Array.isArray(items)) return;

    const wrap = document.createElement("div");
    wrap.className = "quiz";

    items.forEach(function (q) {
      const item = document.createElement("div");
      item.className = "quiz-item";

      const qEl = document.createElement("p");
      qEl.className = "quiz-question";
      qEl.textContent = q.question;
      item.appendChild(qEl);

      const options = document.createElement("div");
      options.className = "quiz-options";

      q.options.forEach(function (o) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "quiz-option";
        btn.textContent = o.text;
        btn.addEventListener("click", function () {
          if (options.dataset.answered) return;
          options.dataset.answered = "1";

          const fb = document.createElement("p");
          fb.className = "quiz-feedback";
          if (o.correct) {
            btn.classList.add("is-correct");
            fb.classList.add("quiz-correct");
            fb.textContent = "Correct — " + (o.why || "");
          } else {
            btn.classList.add("is-wrong");
            fb.classList.add("quiz-wrong");
            fb.textContent = "Not quite — " + (o.why || "");
          }
          // reveal the right answer regardless
          options.querySelectorAll(".quiz-option").forEach(function (b, i) {
            if (q.options[i] && q.options[i].correct) b.classList.add("is-correct");
          });
          item.appendChild(fb);
        });
        options.appendChild(btn);
      });

      item.appendChild(options);
      wrap.appendChild(item);
    });

    script.insertAdjacentElement("afterend", wrap);
  }

  document.querySelectorAll('script.quiz-data').forEach(renderQuiz);
})();
