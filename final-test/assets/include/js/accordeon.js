/**
 * Script pour gérer les accordéons
 * Permet d'afficher/masquer le contenu lorsqu'on clique sur l'en-tête
 * avec une transition fluide
 * Chaque accordéon s'ouvre de manière indépendante
 */

document.addEventListener('DOMContentLoaded', function() {
    // Sélectionner tous les accordéons individuels
    const accordeonCards = document.querySelectorAll('.accordeon-card');
    
    // Ajouter un écouteur d'événement à chaque en-tête d'accordéon
    accordeonCards.forEach(card => {
        card.addEventListener('click', function() {
            // Récupérer le conteneur parent de cette carte
            const container = this.closest('.accordeon-card-container');
            
            // Basculer la classe active uniquement pour ce conteneur spécifique
            if (container) {
                container.classList.toggle('accordeon-active');
            }
        });
    });
});
