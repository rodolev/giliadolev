/**
 * Gilia Dolev | Breastfeeding Consultant (Home Visits After Birth)
 * Client-Side Script: Dynamic Content Hydration, Form Validation & Scroll-State Fallback
 */

// 1. Scroll-state container query fallback (content-first-noise-reduction)
if (!CSS.supports('container-type', 'scroll-state')) {
  const bar = document.querySelector('.top-bar');
  let lastY = window.scrollY;
  window.addEventListener(
    'scroll',
    () => {
      const y = Math.max(0, Math.min(window.scrollY, document.documentElement.scrollHeight - window.innerHeight));
      if (y === lastY) return;
      bar?.classList.toggle('is-hidden', y > lastY && y > bar.offsetHeight);
      lastY = y;
    },
    { passive: true }
  );
}

// 2. UserInvalidFallback Utility (validate-input-after-interaction)
const UserInvalidFallback = (() => {
  const dirtyState = new WeakMap();

  const updateState = (input) => {
    const isValid = input.checkValidity();

    input.classList.toggle('user-invalid-fallback', !isValid);
    input.classList.toggle('user-valid-fallback', isValid);

    if (!isValid) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  };

  const handleEvent = (event) => {
    const input = event.target;

    if (event.type === 'reset') {
      const controls = input.elements || [];
      for (const control of controls) {
        dirtyState.delete(control);
        control.classList.remove('user-invalid-fallback');
        control.classList.remove('user-valid-fallback');
        control.removeAttribute('aria-invalid');
      }
      return;
    }

    if (!input.checkValidity) return;

    if (event.type === 'input' || event.type === 'change') {
      const state = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
      state.hasInteracted = true;
      dirtyState.set(input, state);
      if (state.hasBlurred) {
        updateState(input);
      }
    } else if (event.type === 'blur') {
      const state = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
      state.hasBlurred = true;
      dirtyState.set(input, state);
      if (state.hasInteracted) {
        updateState(input);
      }
    }
  };

  const init = (root = document) => {
    if (CSS.supports('selector(:user-invalid)')) return;

    root.addEventListener('blur', handleEvent, true);
    root.addEventListener('input', handleEvent);
    root.addEventListener('change', handleEvent);
    root.addEventListener('reset', handleEvent, true);
  };

  return { init };
})();

// 3. Apply editable site content safely via textContent & DOM APIs
let currentPhoneClean = '972522524579';

const applyContentToDOM = (data) => {
  if (!data || typeof data !== 'object') return;

  const textFields = [
    'brandName',
    'brandRole',
    'phoneDisplay',
    'heroEyebrow',
    'heroTitle',
    'heroLead',
    'heroWhatsappBtn',
    'heroContactBtn',
    'aboutHeading',
    'aboutParagraph1',
    'aboutParagraph2',
    'qualificationsHeading',
    'visitHeading',
    'contactHeading',
    'contactSubtitle',
    'footerCopy'
  ];

  textFields.forEach((field) => {
    if (typeof data[field] === 'string') {
      document.querySelectorAll(`[data-field="${field}"]`).forEach((el) => {
        el.textContent = data[field];
      });
    }
  });

  if (typeof data.phoneClean === 'string' && data.phoneClean.trim()) {
    currentPhoneClean = data.phoneClean.replace(/\D/g, '');
    const heroWa = document.getElementById('hero-whatsapp-link');
    const contactWa = document.getElementById('contact-whatsapp-link');
    const contactTel = document.getElementById('contact-tel-link');

    if (heroWa) {
      heroWa.href = `https://wa.me/${currentPhoneClean}?text=${encodeURIComponent('היי גיליה, אשמח לשוחח לגבי פגישת ייעוץ הנקה')}`;
    }
    if (contactWa) {
      contactWa.href = `https://wa.me/${currentPhoneClean}?text=${encodeURIComponent('היי גיליה, אשמח לשוחח לגבי פגישת ייעוץ הנקה')}`;
    }
    if (contactTel) {
      contactTel.href = `tel:+${currentPhoneClean}`;
    }
  }

  if (typeof data.heroImage === 'string' && data.heroImage.trim()) {
    const heroImg = document.getElementById('hero-image-el');
    if (heroImg) {
      heroImg.src = data.heroImage;
    }
  }

  if (Array.isArray(data.qualificationsBullets)) {
    const qualListEl = document.getElementById('qualifications-bullets-list');
    if (qualListEl) {
      const items = data.qualificationsBullets
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => {
          const li = document.createElement('li');
          li.textContent = item.trim();
          return li;
        });
      qualListEl.replaceChildren(...items);
    }
  }

  if (Array.isArray(data.visitBullets)) {
    const listEl = document.getElementById('visit-bullets-list');
    if (listEl) {
      const items = data.visitBullets
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => {
          const li = document.createElement('li');
          li.textContent = item.trim();
          return li;
        });
      listEl.replaceChildren(...items);
    }
  }
};

const loadSiteContent = async () => {
  try {
    const res = await fetch('data/content.json', { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      applyContentToDOM(data);
    }
  } catch {
    // Fallback to inline HTML content when opened via file://
  }
};

document.addEventListener('DOMContentLoaded', () => {
  // If opened as a local file://, point the admin link directly to the running local server
  if (window.location.protocol === 'file:') {
    const adminLink = document.querySelector('.footer-admin-link');
    if (adminLink) {
      adminLink.href = 'http://localhost:3000/admin';
    }
  }

  loadSiteContent();

  // Block right-click context menu and dragging on the photo container
  const heroVisual = document.querySelector('.hero-visual');
  if (heroVisual) {
    heroVisual.addEventListener('contextmenu', (e) => e.preventDefault());
    heroVisual.addEventListener('dragstart', (e) => e.preventDefault());
  }

  // Track WhatsApp & Phone clicks in GA4 (no PII)
  document.getElementById('hero-whatsapp-link')?.addEventListener('click', () => {
    window.gtag?.('event', 'contact', { method: 'whatsapp_hero' });
  });
  document.getElementById('contact-whatsapp-link')?.addEventListener('click', () => {
    window.gtag?.('event', 'contact', { method: 'whatsapp_contact' });
  });
  document.getElementById('contact-tel-link')?.addEventListener('click', () => {
    window.gtag?.('event', 'contact', { method: 'phone_call' });
  });

  const form = document.getElementById('consultation-form');
  if (!form) return;

  UserInvalidFallback.init(form);

  const syncAria = (el) => {
    if (!el || typeof el.matches !== 'function') return;
    if (CSS.supports('selector(:user-invalid)')) {
      el.setAttribute('aria-invalid', el.matches(':user-invalid') ? 'true' : 'false');
    }
  };

  form.addEventListener('blur', (e) => syncAria(e.target), true);
  form.addEventListener('input', (e) => {
    if (e.target.hasAttribute?.('aria-invalid')) syncAria(e.target);
  });

  const feedbackBox = document.getElementById('form-feedback');
  const whatsappLink = document.getElementById('feedback-whatsapp-link');
  const submitBtn = document.getElementById('submit-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!form.checkValidity()) {
      const firstInvalid = form.querySelector(':invalid');
      if (firstInvalid) {
        firstInvalid.classList.add('user-invalid-fallback');
        firstInvalid.setAttribute('aria-invalid', 'true');
        firstInvalid.focus();
      }
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    const formData = new FormData(form);
    const name = String(formData.get('full_name') || '').trim();
    const phone = String(formData.get('phone') || '').trim();
    const notes = String(formData.get('message') || '').trim();

    // Update UI immediately so the user gets instant feedback
    window.gtag?.('event', 'generate_lead', { method: 'contact_form' });

    const whatsappText = `היי גיליה, שמי ${name} (${phone}). אשמח לשוחח לגבי פגישת ייעוץ הנקה.${notes ? ' ' + notes : ''}`;
    if (whatsappLink) {
      whatsappLink.href = `https://wa.me/${currentPhoneClean}?text=${encodeURIComponent(whatsappText)}`;
    }

    if (feedbackBox) {
      feedbackBox.hidden = false;
    }

    form.reset();
    if (submitBtn) {
      setTimeout(() => {
        submitBtn.disabled = false;
      }, 600);
    }

    // Send email to gilia.dolev@gmail.com in the background via FormSubmit AJAX
    fetch('https://formsubmit.co/ajax/gilia.dolev@gmail.com', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        _subject: `פנייה חדשה מהאתר: ${name}`,
        שם: name,
        טלפון: phone,
        הודעה: notes || 'ללא הודעה נוספת',
        _template: 'table'
      })
    }).catch(() => {});

    // Also save to local backend if running locally
    if (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    ) {
      fetch('/api/leads', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, notes })
      }).catch(() => {});
    }
  });
});
