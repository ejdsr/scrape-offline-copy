function countTo(target, elementId, duration) {
    const maxCount = target;
    const startTime = Date.now();

    const easeOutCubic = (t, b, c, d) => {
        t /= d;
        t--;
        return c * (t * t * t + 1) + b;
    };

    const timer = () => {
        const currentTime = Date.now();
        const timeElapsed = currentTime - startTime;
        const nextCount = Math.round(
            easeOutCubic(timeElapsed, 0, maxCount, duration)
        );

        // Cible uniquement le span.count à l'intérieur de l'élément principal
        const numberElem = document.getElementById(elementId).querySelector('.count');
        if (numberElem) {
            if (nextCount < maxCount && timeElapsed < duration) {
                numberElem.textContent = nextCount;
                requestAnimationFrame(timer);
            } else {
                numberElem.textContent = maxCount;
            }
        }
    };

    requestAnimationFrame(timer);
}

// Intersection Observer API
const observer2 = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                countTo(
                    parseInt(entry.target.dataset.target),
                    entry.target.id,
                    5000
                );
                observer2.unobserve(entry.target); // Arrêtez d'observer une fois déclenché
            }
        });
    },
    {
        threshold: 0.8, // Déclenche lorsque 80% de l'élément est visible
    }
);

document.querySelectorAll(".data-number").forEach((counter) => {
    observer2.observe(counter);
});
