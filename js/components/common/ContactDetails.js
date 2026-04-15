export function ContactDetails() {
    const address = '80 Shawsheen Road, Andover, MA 01810';
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

    return `
        <div class="contact-details-card">
            <div>
                <h3>Get in Touch</h3>
                <ul class="contact-info-list">
                    <li>
                        <img class="contact-icon" src="/assets/icons/email.svg" alt="Email icon" draggable="false">
                        <a href="mailto:andoverview@andoverma.us">andoverview@andoverma.us</a>
                    </li>
                    <li>
                        <img class="contact-icon" src="/assets/icons/location.svg" alt="Location icon" draggable="false">
                        <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer">
                            80 Shawsheen Road<br>Andover, MA 01810<br>USA
                        </a>
                    </li>
                </ul>
            </div>

            <div class="map-container">
                <iframe
                    class="map-iframe"
                    src="https://maps.google.com/maps?q=Andover%20High%20School%20MA&t=&z=15&ie=UTF8&iwloc=&output=embed"
                    allowfullscreen=""
                    loading="lazy"
                    referrerpolicy="no-referrer-when-downgrade"
                    title="Andover High School Location">
                </iframe>
            </div>
        </div>
    `;
}