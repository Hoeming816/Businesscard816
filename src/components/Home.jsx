import { useEffect, useState } from 'react';
import { useApp } from '../context.js';
import Contacts from './Contacts.jsx';
import Minutes from './Minutes.jsx';
import Todo from './Todo.jsx';
import { Icon } from './ui.jsx';
import { useBack } from '../back.js';
import cardsIcon from '../assets/tab-business-cards.png';
import meetingIcon from '../assets/tab-meeting.png';
import todoIcon from '../assets/tab-todo-list.png';
import noteIcon from '../assets/tab-quick-notes.png';

const SECTIONS = [
  { value: 'cards', label: 'Business Cards', img: cardsIcon },
  { value: 'minutes', label: 'Meeting', img: meetingIcon, feature: 'meeting' },
  { value: 'todo', label: 'To Do List', img: todoIcon, feature: 'todo' },
  { value: 'notes', label: 'Quick Notes', img: noteIcon },
];

// Which section is open, kept for this browser tab so Scan, Team or a refresh
// come back to it. Cleared on sign-in, so signing in starts at the selection page.
const SECTION_KEY = 'nomiqo.homeSection';
const readSection = () => { try { return sessionStorage.getItem(SECTION_KEY) || null; } catch { return null; } };
export function resetHomeSection() { try { sessionStorage.removeItem(SECTION_KEY); } catch { /* private mode */ } }

/**
 * The home screen. With Meeting or To Do List on: a selection page with a tile
 * for each section, each opening with a Back button to return here. Without
 * them (the default): just the card list.
 */
export default function Home() {
  const { can, tasks } = useApp();
  const [section, setSectionRaw] = useState(readSection);
  const picker = can('meeting') || can('todo');
  const sections = SECTIONS.filter((s) => !s.feature || can(s.feature));
  const setSection = (v) => {
    setSectionRaw(v);
    try { if (v) sessionStorage.setItem(SECTION_KEY, v); else sessionStorage.removeItem(SECTION_KEY); } catch { /* private mode */ }
  };
  const inSection = picker && sections.some((s) => s.value === section);
  useBack(() => setSection(null), inSection);
  if (!picker) return <div className="home"><Contacts /></div>;

  if (!inSection) {
    return <HomePick sections={sections} onPick={setSection} counts={{ todo: tasks.filter((t) => t.status !== 'done').length }} />;
  }
  return (
    <div className="home">
      <button type="button" className="btn btn-ghost btn-sm home-back" onClick={() => setSection(null)}>
        <Icon name="chevronLeft" size={16} /> Back
      </button>
      {section === 'cards' ? <Contacts /> : section === 'minutes' ? <Minutes /> : section === 'todo' ? <Todo />
        : <ComingSoon section={SECTIONS.find((s) => s.value === section)} />}
    </div>
  );
}

/** The selection page, centred in the screen. */
function HomePick({ sections, onPick, counts }) {
  // Signing in can leave the page scrolled (the phone keyboard); start at the top.
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return (
    <div className="home home-pick">
      <h1 className="sr-only">Choose where to go</h1>
      <div className="home-tiles">
        {sections.map((s) => (
          <button key={s.value} type="button" className="home-tile" onClick={() => onPick(s.value)}
            aria-label={counts[s.value] ? `${s.label}, ${counts[s.value]} not done` : undefined}>
            <img src={s.img} alt="" />
            <span>{s.label}</span>
            {counts[s.value] > 0 && <span className="home-tile-count" aria-hidden="true">{counts[s.value] > 99 ? '99+' : counts[s.value]}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Quick Notes isn't built yet; its tile opens this. */
function ComingSoon({ section }) {
  return (
    <div className="empty">
      <img src={section.img} alt="" width="96" height="96" />
      <h3>{section.label}</h3>
      <p>Coming soon.</p>
    </div>
  );
}
