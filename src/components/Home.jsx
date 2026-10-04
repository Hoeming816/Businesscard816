import { useEffect, useState } from 'react';
import { useApp } from '../context.js';
import Contacts from './Contacts.jsx';
import Minutes from './Minutes.jsx';
import { Icon } from './ui.jsx';
import { useBack } from '../back.js';
import cardsIcon from '../assets/tab-business-cards.png';
import meetingIcon from '../assets/tab-meeting.png';
import todoIcon from '../assets/tab-todo-list.png';
import noteIcon from '../assets/tab-quick-notes.png';

const SECTIONS = [
  { value: 'cards', label: 'Business Cards', img: cardsIcon },
  { value: 'minutes', label: 'Meeting', img: meetingIcon },
  { value: 'todo', label: 'To Do List', img: todoIcon },
  { value: 'notes', label: 'Quick Notes', img: noteIcon },
];

// Which section is open, kept for this browser tab so Scan, Team or a refresh
// come back to it. Cleared on sign-in, so signing in starts at the selection page.
const SECTION_KEY = 'nomiqo.homeSection';
const readSection = () => { try { return sessionStorage.getItem(SECTION_KEY) || null; } catch { return null; } };
export function resetHomeSection() { try { sessionStorage.removeItem(SECTION_KEY); } catch { /* private mode */ } }

/**
 * The home screen. With Meeting on: a selection page with Business Cards and
 * Meeting, each opening its section with a Back button to return here.
 * Without it (the default): just the card list.
 */
export default function Home() {
  const { can } = useApp();
  const [section, setSectionRaw] = useState(readSection);
  const setSection = (v) => {
    setSectionRaw(v);
    try { if (v) sessionStorage.setItem(SECTION_KEY, v); else sessionStorage.removeItem(SECTION_KEY); } catch { /* private mode */ }
  };
  const inSection = can('meeting') && SECTIONS.some((s) => s.value === section);
  useBack(() => setSection(null), inSection);
  if (!can('meeting')) return <div className="home"><Contacts /></div>;

  if (!inSection) return <HomePick onPick={setSection} />;
  return (
    <div className="home">
      <button type="button" className="btn btn-ghost btn-sm home-back" onClick={() => setSection(null)}>
        <Icon name="chevronLeft" size={16} /> Back
      </button>
      {section === 'cards' ? <Contacts /> : section === 'minutes' ? <Minutes /> : <ComingSoon section={SECTIONS.find((s) => s.value === section)} />}
    </div>
  );
}

/** The selection page, centred in the screen. */
function HomePick({ onPick }) {
  // Signing in can leave the page scrolled (the phone keyboard); start at the top.
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return (
    <div className="home home-pick">
      <h1 className="sr-only">Choose where to go</h1>
      <div className="home-tiles">
        {SECTIONS.map((s) => (
          <button key={s.value} type="button" className="home-tile" onClick={() => onPick(s.value)}>
            <img src={s.img} alt="" />
            <span>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** To Do List and Quick Notes aren't built yet; their tiles open this. */
function ComingSoon({ section }) {
  return (
    <div className="empty">
      <img src={section.img} alt="" width="96" height="96" />
      <h3>{section.label}</h3>
      <p>Coming soon.</p>
    </div>
  );
}
