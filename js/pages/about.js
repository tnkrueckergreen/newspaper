import { getCombinedData } from '../lib/api.js';
import { getCurrentUser } from '../lib/auth.js';
import { toRootRelativePath } from '../lib/paths.js';

function createHTML(staff, isAdmin) {
    const staffCards = staff.map(person => {
        const imageSrc = toRootRelativePath(person.image);
        const altText = `Image for ${person.name}`;

        return `
            <div class="staff-card" data-name="${person.name}">
                <div class="staff-card-img">
                    <img src="${imageSrc}" alt="${altText}" loading="lazy">
                </div>
                <h4>${person.name}</h4>
                <p>${person.role}</p>
            </div>
        `;
    }).join('');

    const adminBarHTML = isAdmin ? `
        <div class="article-admin-bar" style="max-width: 750px; margin: 0 auto 2rem auto; text-align: left;">
            <span class="article-admin-bar__label">Admin</span>
            <a href="/account" id="about-manage-staff-btn" class="article-admin-bar__edit-btn" title="Manage Staff in Admin Panel">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Manage Staff
            </a>
        </div>
    ` : '';

    return `
        <section class="page about-page">
            <div class="container">
                <div class="page-header">
                    ${adminBarHTML}
                    <h1>About ANDOVERVIEW</h1>
                </div>

                <div class="collapsible-card" id="about-description-card">
                    <div class="card-header" role="button" aria-expanded="false" aria-controls="about-card-content">
                        <h3>Our Mission & Policies</h3>
                        <button class="card-toggle-btn" aria-label="Toggle description">
                            <img src="/assets/icons/chevron-down.svg" alt="" aria-hidden="true">
                        </button>
                    </div>
                    <div class="card-content-wrapper" id="about-card-content">
                        <div class="card-content">
                            <p>ANDOVERVIEW is a publication written, edited and designed by the Newspaper Production class to serve as an open forum for students to discuss issues relevant to the Andover High School community.</p>
                            <p>Letters to the editor and guest commentaries are encouraged; please email submissions to the following address: <a href="mailto:andoverview@andoverma.us">andoverview@andoverma.us</a>.</p>
                            <p>If you would like to write for us or join the newspaper staff, please visit the <a href="/contact">Contact page</a> for more information.</p>
                            <p>Include contact information for verification purposes. The staff of ANDOVERVIEW reviews letters to the editor and guest commentaries and reserves the right to refuse material for reasons pertaining to length, clarity, libel, obscenity, copyright infringement, or material disruption to the educational process of Andover High School.</p>
                        </div>
                    </div>
                </div>

                <div class="page-header team-header">
                    <h2>Meet the Team</h2>
                    <p>Click a card to learn more about each staff member!</p>
                </div>
                <div class="staff-grid">${staffCards}</div>
            </div>
        </section>
    `;
}

function attachEventListeners() {
    const card = document.getElementById('about-description-card');
    const header = card?.querySelector('.card-header');

    if (header) {
        header.addEventListener('click', () => {
            const isExpanded = card.classList.toggle('is-expanded');
            header.setAttribute('aria-expanded', isExpanded);
        });
    }

    const manageStaffBtn = document.getElementById('about-manage-staff-btn');
    if (manageStaffBtn) {
        manageStaffBtn.addEventListener('click', () => {
            sessionStorage.setItem('adminAutoOpenTab', 'staff');
        });
    }
}

export async function render(container) {
    const data = await getCombinedData();
    if (!data) return; // null = cache invalidated mid-flight (e.g. logout); page reload follows
    const { staff } = data;

    const currentUser = getCurrentUser();
    const isAdmin = currentUser && currentUser.is_admin;

    const sanitizedHTML = DOMPurify.sanitize(createHTML(staff, isAdmin));

    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitizedHTML, 'text/html');
    Array.from(doc.body.children).forEach(node => {
        container.appendChild(node);
    });

    attachEventListeners();
}
