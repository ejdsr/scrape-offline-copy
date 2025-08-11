// Fonction throttle pour optimiser les événements fréquents
const throttle = (func, limit) => {
    let inThrottle;

    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
};

// *-------------------------------------------------------------
//* -----Intersection Observer -------------------------------
// *-------------------------------------------------------------

const observerOptions = {
    root: null,
    rootMargin: "-20px",
    threshold: 0.1,
};

const handleIntersect = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            entry.target.classList.add("reveal-visible");
        }
    });
}, observerOptions);

// Utilisation de la méthode plus performante querySelectorAll une seule fois
const elementsToObserve = document.querySelectorAll(
    '[class*="reveal-"], [class*="revealLR-"], [class*="revealRL-"]'
);
elementsToObserve.forEach((element) => handleIntersect.observe(element));

// *-------------------------------------------------------------
//* -----Lecteur vidéo optimisé -------------------------------
// *-------------------------------------------------------------
const buttons = document.querySelectorAll(".consent-button");

const createIframe = (dataSrc) => {
    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, {
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        border: "none",
    });
    iframe.src = dataSrc;
    iframe.title = "vimeo-player";
    iframe.setAttribute("allowfullscreen", "");
    return iframe;
};

buttons.forEach((button) => {
    button.addEventListener("click", (e) => {
        const consentBanner = e.target.parentElement;
        const container = consentBanner.parentElement;

        consentBanner.style.display = "none";
        container.appendChild(createIframe(e.target.getAttribute("data-src")));
    });
});

// ---------------------------------------------------
// ---LOGO SCROLL BANDEAU-----
// ---------------------------------------------------

const scrollers = document.querySelectorAll(".scroller");

if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    addAnimation();
}

function addAnimation() {
    scrollers.forEach((scroller) => {
        scroller.setAttribute("data-animated", true);

        const scrollerInner = scroller.querySelector(".scroller__inner");
        const scrollerContent = Array.from(scrollerInner.children);

        scrollerContent.forEach((item) => {
            const duplicatedItem = item.cloneNode(true);
            duplicatedItem.setAttribute("aria-hidden", true);
            
            // Rendre les liens non focalisables dans les éléments dupliqués
            const focusableElements = duplicatedItem.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
            focusableElements.forEach(el => {
                el.setAttribute('tabindex', '-1');
                // Conserver l'apparence visuelle mais empêcher la navigation
                el.style.pointerEvents = 'none';
            });
            
            scrollerInner.appendChild(duplicatedItem);
        });
    });
}

// *---------LENIS-----------------------------------------------------------
const lenis = new Lenis();

lenis.on("scroll", (e) => {
    //   console.log(e);
});

function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
}

requestAnimationFrame(raf);

// *---------NEW MENU MOBILE-----------------------------------------------------------
document.addEventListener("DOMContentLoaded", function () {
    // Sélection des éléments du DOM (regroupés pour meilleure lisibilité)
    const elements = {
        navbar: document.querySelector(".navbar"),
        menuToggle: document.querySelector(".mobile-menu-toggle"),
        menuItems: document.querySelectorAll(".menu-item"),
        submenuLinks: document.querySelectorAll(".submenu-item a"),
        overlay: document.querySelector(".mobile-menu-overlay"),
    };

    // Constantes
    const MOBILE_BREAKPOINT = 768;
    const CLASSES = {
        menuActive: "mobile-menu-active",
        bodyLocked: "menu-open",
        submenuOpen: "submenu-open",
    };

    // Fonctions utilitaires
    function closeMenu() {
        elements.navbar.classList.remove(CLASSES.menuActive);
        document.body.classList.remove(CLASSES.bodyLocked);
    }

    function closeAllSubmenus() {
        elements.menuItems.forEach((item) => {
            item.classList.remove(CLASSES.submenuOpen);
        });
    }

    function isMobileView() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    // 1. Toggle du menu mobile
    elements.menuToggle.addEventListener("click", function (e) {
        e.stopPropagation();
        elements.navbar.classList.toggle(CLASSES.menuActive);
        document.body.classList.toggle(CLASSES.bodyLocked);
    });

    // 2. Gestion des sous-menus en mode accordéon sur mobile
    elements.menuItems.forEach((item) => {
        const menuLink = item.querySelector("a");
        if (menuLink) {
            menuLink.addEventListener("click", function (e) {
                if (isMobileView()) {
                    e.preventDefault();
                    const isCurrentlyOpen = item.classList.contains(
                        CLASSES.submenuOpen
                    );

                    // Ferme tous les sous-menus
                    closeAllSubmenus();

                    // Rouvre celui cliqué s'il n'était pas déjà ouvert
                    if (!isCurrentlyOpen) {
                        item.classList.add(CLASSES.submenuOpen);
                    }
                }
            });
        }
    });

    // 3. Gestion de la fermeture du menu
    // 3.1 Fermeture en cliquant sur l'overlay
    elements.overlay.addEventListener("click", closeMenu);

    // 3.2 Fermeture en cliquant sur un lien de sous-menu
    elements.submenuLinks.forEach((link) => {
        link.addEventListener("click", function () {
            if (isMobileView()) {
                closeMenu();
            }
        });
    });

    // 4. Gestion du redimensionnement
    // Utilisation d'un debounce pour optimiser les performances
    let resizeTimer;
    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            if (!isMobileView()) {
                closeMenu();
                closeAllSubmenus();
            }
        }, 100);
    });

    // 5. Prévention du scroll lorsque le menu est ouvert
    document.addEventListener(
        "touchmove",
        function (e) {
            if (
                document.body.classList.contains(CLASSES.bodyLocked) &&
                !elements.navbar.contains(e.target)
            ) {
                e.preventDefault();
            }
        },
        { passive: false }
    );
});
