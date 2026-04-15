import { PageHeader } from '../components/layout/PageHeader.js';
import { Container } from '../components/layout/Container.js';
import { Section } from '../components/layout/Section.js';

function createHTML() {
const opportunitiesSection = `
<div class="opportunities-section">
<h2>Ways to Contribute</h2>
<div class="opportunities-grid">
<div class="opportunity-card">
<div class="opportunity-icon"><img src="/assets/icons/pen.svg" alt="Pen icon"></div>
<h3>Articles & Features</h3>
<p>Inform, engage our community</p>
</div>
<div class="opportunity-card">
<div class="opportunity-icon"><img src="/assets/icons/camera.svg" alt="Camera icon"></div>
<h3>Photography</h3>
<p>Take us to the scene</p>
</div>
<div class="opportunity-card">
<div class="opportunity-icon"><img src="/assets/icons/opinion.svg" alt="Opinion icon"></div>
<h3>Opinion Columns</h3>
<p>Share your perspective</p>
</div>
<div class="opportunity-card">
<div class="opportunity-icon"><img src="/assets/icons/palette.svg" alt="Palette icon"></div>
<h3>Design & Graphics</h3>
<p>Draw readers in</p>
</div>
</div>
</div>
`;

const contactCallout = `
<div class="write-contact-callout">
<div class="callout-content">
<h3>Ready to Get Started?</h3>
<p>Reach out to us and let's discuss your ideas!</p>
<div class="callout-actions">
<a href="mailto:andoverview@andoverma.us" class="contact-btn primary">Email Us</a>
<a href="/contact" class="contact-btn secondary">Contact Page</a>
</div>
</div>
</div>
`;

const pageContent = `
${PageHeader('Write for Us', 'Join our staff or contribute as a guest writer.')}

<div class="write-content-wrapper">
${opportunitiesSection}

<div class="write-sections">
<div class="write-section">
<h2>Join Our Staff</h2>
<p>Newspaper Productions is a course at Andover High School rather than a club, so the only way to join the staff is to sign up for the course during course selection or switch into it in the first few weeks of the school year.</p>
<p>Newspaper Productions is a year-long half credit course that meets every Monday night from 5 p.m. to 7 p.m. Students have to attend almost every meeting to participate in the course.</p>
</div>

<div class="write-section">
<h2>Guest Contributions</h2>
<p>If you want to write for us without joining the staff, we welcome guest articles, photos, and opinion columns. Please email us at <a href="mailto:andoverview@andoverma.us">andoverview@andoverma.us</a> for more information.</p>
<p>If you would like to contact us for other purposes such as placing an ad or to ask us to cover a specific issue, please email us or contact us through our <a href="/contact">contact page</a>. You can also contact us to have your club be Club of the Month.</p>
</div>

<div class="write-section">
<h2>Editorial Guidelines</h2>
<p>The staff of ANDOVERVIEW reviews letters to the editor and guest commentaries and reserves the right to refuse material for reasons pertaining to length, clarity, libel, obscenity, copyright infringement, or material disruption to the educational process of Andover High School.</p>
</div>
</div>

${contactCallout}
</div>
`;

return Section({
className: 'page write-for-us-page',
content: Container(pageContent)
});
}

export function render(container) {
container.innerHTML = DOMPurify.sanitize(createHTML());
}