import { getCombinedData } from './api.js';
import { toRootRelativePath } from './paths.js';

export function initModal() {
    const modalOverlay = document.getElementById('staff-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalBodyContent = document.getElementById('modal-body-content');

    let staffList = [];
    let currentIndex = -1;

    const createStaffModalHTML = (person) => `
        <img src="${toRootRelativePath(person.image)}" alt="${person.name}" class="modal-img">
        <div class="modal-bio">
            <h2>${person.name}</h2>
            <h4>${person.role}</h4>
            <p>${person.bio}</p>
        </div>
    `;

    const openModal = (person) => {
        const sanitizedHTML = DOMPurify.sanitize(createStaffModalHTML(person));

        while (modalBodyContent.firstChild) {
            modalBodyContent.removeChild(modalBodyContent.firstChild);
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(sanitizedHTML, 'text/html');
        Array.from(doc.body.children).forEach(node => {
            modalBodyContent.appendChild(node);
        });

        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    };

    const closeModal = () => {
        modalOverlay.classList.remove('active');
        document.body.style.overflow = '';
        currentIndex = -1;
    };

    const navigateModal = (direction) => {
        if (!modalOverlay.classList.contains('active') || staffList.length === 0) return;
        currentIndex = (currentIndex + direction + staffList.length) % staffList.length;
        openModal(staffList[currentIndex]);
    };

    document.getElementById('main-content').addEventListener('click', async (e) => {
        const card = e.target.closest('.staff-card');
        if (card) {
            const staffName = card.dataset.name;
            const data = await getCombinedData();
            if (!data) return;
            const { staff } = data;
            staffList = staff;
            const index = staff.findIndex(p => p.name === staffName);
            if (index !== -1) {
                currentIndex = index;
                openModal(staff[index]);
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (!modalOverlay.classList.contains('active')) return;
        if (e.key === 'ArrowRight') navigateModal(1);
        else if (e.key === 'ArrowLeft') navigateModal(-1);
        else if (e.key === 'Escape') closeModal();
    });

    modalCloseBtn.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    return closeModal;
}
