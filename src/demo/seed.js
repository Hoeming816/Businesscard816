// Sample data for the clickable demo. All people, companies, phone numbers
// and e-mail addresses are fictional.

import { toISODate, addDays } from '../filters.js';

export const ME = 'u-alex';

export const PROFILES = [
  { id: 'u-alex', username: 'alex.tan', full_name: 'Alex Tan', is_super_admin: true, status: 'active', suspended_reason: null, created_at: '2025-11-02T09:12:00Z' },
  { id: 'u-maria', username: 'maria.santos', full_name: 'Maria Santos', is_super_admin: false, status: 'active', suspended_reason: null, created_at: '2025-11-05T03:40:00Z' },
  { id: 'u-ravi', username: 'ravi.kumar', full_name: 'Ravi Kumar', is_super_admin: false, status: 'active', suspended_reason: null, created_at: '2026-01-14T06:20:00Z' },
  { id: 'u-siti', username: 'siti.aminah', full_name: 'Siti Aminah', is_super_admin: false, status: 'active', suspended_reason: null, created_at: '2026-02-03T01:05:00Z' },
  { id: 'u-jun', username: 'jun.delacruz', full_name: 'Jun Dela Cruz', is_super_admin: false, status: 'suspended', suspended_reason: 'Left the company. Access cancelled at the request of Northbridge Networks.', created_at: '2026-02-20T08:00:00Z' },
  { id: 'u-weiling', username: 'weiling.goh', full_name: 'Wei Ling Goh', is_super_admin: false, status: 'active', suspended_reason: null, created_at: '2026-05-11T10:30:00Z' },
  { id: 'u-ahmad', username: 'ahmad.r', full_name: 'Ahmad Razak', is_super_admin: false, status: 'active', suspended_reason: null, created_at: '2026-08-22T04:45:00Z' },
];

export const WORKSPACES = [
  { id: 'w-north', name: 'Northbridge Networks', owner_id: 'u-alex', status: 'active', created_at: '2025-11-02T09:12:00Z' },
  { id: 'w-harbour', name: 'Harbour Fibre Co', owner_id: 'u-siti', status: 'active', created_at: '2026-02-03T01:05:00Z' },
  { id: 'w-maria', name: "Maria Santos's cards", owner_id: 'u-maria', status: 'active', created_at: '2025-11-05T03:40:00Z' },
  { id: 'w-ravi', name: "Ravi Kumar's cards", owner_id: 'u-ravi', status: 'active', created_at: '2026-01-14T06:20:00Z' },
  { id: 'w-jun', name: "Jun Dela Cruz's cards", owner_id: 'u-jun', status: 'suspended', created_at: '2026-02-20T08:00:00Z' },
  { id: 'w-weiling', name: 'Goh Engineering', owner_id: 'u-weiling', status: 'active', created_at: '2026-05-11T10:30:00Z' },
  { id: 'w-ahmad', name: "Ahmad Razak's cards", owner_id: 'u-ahmad', status: 'active', created_at: '2026-08-22T04:45:00Z' },
];

export const MEMBERS = [
  { workspace_id: 'w-north', user_id: 'u-alex', role: 'admin', status: 'active', created_at: '2025-11-02T09:12:00Z' },
  { workspace_id: 'w-north', user_id: 'u-maria', role: 'editor', status: 'active', created_at: '2025-11-06T02:00:00Z' },
  { workspace_id: 'w-north', user_id: 'u-ravi', role: 'viewer', status: 'active', created_at: '2026-01-15T02:00:00Z' },
  { workspace_id: 'w-north', user_id: 'u-jun', role: 'editor', status: 'active', created_at: '2026-02-21T02:00:00Z' },
  { workspace_id: 'w-harbour', user_id: 'u-siti', role: 'admin', status: 'active', created_at: '2026-02-03T01:05:00Z' },
  { workspace_id: 'w-harbour', user_id: 'u-alex', role: 'editor', status: 'active', created_at: '2026-03-01T01:05:00Z' },
  { workspace_id: 'w-maria', user_id: 'u-maria', role: 'admin', status: 'active', created_at: '2025-11-05T03:40:00Z' },
  { workspace_id: 'w-ravi', user_id: 'u-ravi', role: 'admin', status: 'active', created_at: '2026-01-14T06:20:00Z' },
  { workspace_id: 'w-jun', user_id: 'u-jun', role: 'admin', status: 'active', created_at: '2026-02-20T08:00:00Z' },
  { workspace_id: 'w-weiling', user_id: 'u-weiling', role: 'admin', status: 'active', created_at: '2026-05-11T10:30:00Z' },
  { workspace_id: 'w-weiling', user_id: 'u-ahmad', role: 'viewer', status: 'revoked', created_at: '2026-08-23T10:30:00Z' },
  { workspace_id: 'w-ahmad', user_id: 'u-ahmad', role: 'admin', status: 'active', created_at: '2026-08-22T04:45:00Z' },
];

// name, title, company, dept, domain, industry, type, category, function, seniority,
// city, region, country, relationship, lead status, source, priority, opportunities, tags
const P = [
  ['Maricel Villanueva', 'Procurement Manager', 'Luzon Fiber Corp', 'Supply Chain', 'luzonfiber', 'Telecom', 'Customer', 'ISP/Telco', 'Procurement', 'Manager', 'Makati', 'Metro Manila', 'Philippines', 'Existing Customer', 'Won', 'Existing Customer', 'High', ['Fiber/OSP', 'Maintenance'], ['key-account']],
  ['Ramon Aquino', 'Chief Technology Officer', 'Luzon Fiber Corp', 'Technology', 'luzonfiber', 'Telecom', 'Customer', 'ISP/Telco', 'IT', 'C-Level', 'Makati', 'Metro Manila', 'Philippines', 'Existing Customer', 'Negotiating', 'Referral', 'High', ['Network', 'Firewall'], ['key-account', 'decision-maker']],
  ['Kristine Bautista', 'Network Engineer', 'Visayas Netlink', 'Operations', 'visayasnet', 'Telecom', 'Prospect', 'ISP/Telco', 'Engineering', 'Staff', 'Cebu City', 'Cebu', 'Philippines', 'Active Prospect', 'Contacted', 'Exhibition', 'Medium', ['Fiber/OSP'], ['telco-expo']],
  ['Paolo Mendoza', 'Project Director', 'Makati Towers Development', 'Projects', 'makatitowers', 'Real Estate', 'Prospect', 'Developer', 'Project Management', 'Director', 'Taguig', 'Metro Manila', 'Philippines', 'Active Prospect', 'Proposal Sent', 'LinkedIn', 'High', ['Structured Cabling', 'CCTV', 'Smart Office'], ['bgc-tower']],
  ['Angelica Reyes', 'Site Engineer', 'Pasig BuildRight Inc.', 'Engineering', 'buildright', 'Construction', 'Partner', 'General Contractor', 'Engineering', 'Executive/Officer', 'Pasig', 'Metro Manila', 'Philippines', 'Partner', 'Qualified', 'Personal Introduction', 'Medium', ['Structured Cabling'], []],
  ['Benjie Castillo', 'Owner', 'Bayanihan Data Systems', '', 'bayanihandata', 'IT', 'Partner', 'System Integrator', 'Owner/CEO', 'Owner', 'Quezon City', 'Metro Manila', 'Philippines', 'Partner', 'Won', 'Referral', 'High', ['Network', 'Wi-Fi', 'Firewall'], ['reseller']],
  ['Lourdes Navarro', 'General Manager', 'Cebu Harbour Hotel', 'Management', 'cebuharbour', 'Hospitality', 'Customer', 'End User', 'Management', 'Manager', 'Cebu City', 'Cebu', 'Philippines', 'Existing Customer', 'Won', 'Website', 'Medium', ['Wi-Fi', 'CCTV'], ['hotel']],
  ['Dennis Ocampo', 'Purchasing Officer', 'Mindanao Power Cables', 'Purchasing', 'mpcables', 'Manufacturing', 'Supplier', 'Manufacturer', 'Procurement', 'Executive/Officer', 'Davao City', 'Davao del Sur', 'Philippines', 'No Current Relationship', 'New', 'Supplier', 'Low', [], ['cable-supplier']],
  ['Grace Lim', 'VP Operations', 'Sampaguita Savings Bank', 'Operations', 'sampaguitabank', 'Banking', 'Prospect', 'End User', 'Operations', 'C-Level', 'Ortigas', 'Metro Manila', 'Philippines', 'New Lead', 'New', 'Cold Call', 'High', ['Firewall', 'Network'], ['branch-rollout']],
  ['Arnel Garcia', 'Logistics Supervisor', 'Davao Logistics Hub', 'Warehouse', 'davaologistics', 'Logistics', 'Prospect', 'End User', 'Operations', 'Supervisor', 'Davao City', 'Davao del Sur', 'Philippines', 'New Lead', 'Contacted', 'Exhibition', 'Medium', ['CCTV', 'Wi-Fi'], []],
  ['Jasmine Tolentino', 'IT Manager', 'Iloilo Medical Center', 'IT', 'iloilomed', 'Healthcare', 'Customer', 'End User', 'IT', 'Manager', 'Iloilo City', 'Iloilo', 'Philippines', 'Existing Customer', 'Won', 'Referral', 'Medium', ['Network', 'Maintenance'], []],
  ['Rodel Pascual', 'Barangay Engineer', 'Municipality of San Rafael', 'Engineering Office', 'sanrafael.gov', 'Government', 'Government', 'End User', 'Engineering', 'Staff', 'San Rafael', 'Bulacan', 'Philippines', 'No Current Relationship', 'Dormant', 'Cold Call', 'Low', ['CCTV'], ['lgu']],
  ['Carmela Diaz', 'Sales Director', 'Pinoy Distribution Network', 'Sales', 'pinoydist', 'IT', 'Vendor', 'Distributor', 'Sales', 'Director', 'Mandaluyong', 'Metro Manila', 'Philippines', 'Partner', 'Won', 'Supplier', 'Medium', [], ['distributor']],
  ['Teodoro Santiago', 'Consultant', 'Santiago ICT Advisory', '', 'santiagoict', 'IT', 'Consultant', 'Consultant', 'Management', 'Owner', 'Baguio', 'Benguet', 'Philippines', 'No Current Relationship', 'Lost', 'LinkedIn', 'Low', ['Smart Home'], []],
  ['Wei Jie Tan', 'Head of Infrastructure', 'Merlion Systems Pte Ltd', 'Infrastructure', 'merlionsys', 'IT', 'Customer', 'System Integrator', 'IT', 'Director', 'Singapore', 'Central Region', 'Singapore', 'Existing Customer', 'Won', 'Referral', 'High', ['Network', 'Firewall', 'Maintenance'], ['key-account']],
  ['Priya Nair', 'Procurement Executive', 'Merlion Systems Pte Ltd', 'Procurement', 'merlionsys', 'IT', 'Customer', 'System Integrator', 'Procurement', 'Executive/Officer', 'Singapore', 'Central Region', 'Singapore', 'Existing Customer', 'Contacted', 'Existing Customer', 'Medium', ['Structured Cabling'], []],
  ['Marcus Lee', 'Managing Director', 'Straits Cabling Pte Ltd', '', 'straitscabling', 'Construction', 'Contractor', 'Subcontractor', 'Owner/CEO', 'Owner', 'Singapore', 'West Region', 'Singapore', 'Partner', 'Qualified', 'Exhibition', 'High', ['Structured Cabling', 'Fiber/OSP'], ['subcon']],
  ['Hui Min Chua', 'Director of Engineering', 'Orchid Hospitality Group', 'Engineering', 'orchidhotels', 'Hospitality', 'Prospect', 'End User', 'Engineering', 'Director', 'Singapore', 'Central Region', 'Singapore', 'Active Prospect', 'Proposal Sent', 'LinkedIn', 'High', ['Wi-Fi', 'Smart Office'], ['hotel', 'refresh-2027']],
  ['Daniel Koh', 'Channel Manager', 'Kallang Distribution', 'Channel Sales', 'kallangdist', 'IT', 'Vendor', 'Distributor', 'Sales', 'Manager', 'Singapore', 'Central Region', 'Singapore', 'Partner', 'Won', 'Supplier', 'Medium', [], ['distributor']],
  ['Siew Ling Ong', 'Network Planning Lead', 'Lion City Telecom', 'Network Planning', 'lioncitytel', 'Telecom', 'Prospect', 'ISP/Telco', 'Engineering', 'Manager', 'Singapore', 'East Region', 'Singapore', 'Active Prospect', 'Negotiating', 'Exhibition', 'High', ['Fiber/OSP', 'Internet Service'], ['telco-expo']],
  ['Ahmad Faizal', 'Facilities Manager', 'Tanjong Pagar Medical Centre', 'Facilities', 'tpmedical', 'Healthcare', 'Customer', 'End User', 'Operations', 'Manager', 'Singapore', 'Central Region', 'Singapore', 'Existing Customer', 'Won', 'Website', 'Medium', ['CCTV', 'Maintenance'], []],
  ['Rachel Teo', 'Finance Director', 'Jurong Smart Estates', 'Finance', 'jurongsmart', 'Real Estate', 'Prospect', 'Developer', 'Finance', 'Director', 'Singapore', 'West Region', 'Singapore', 'New Lead', 'New', 'Personal Introduction', 'Medium', ['Smart Home'], []],
  ['Kenneth Yeo', 'Account Executive', 'Bukit Data Centre', 'Sales', 'bukitdc', 'IT', 'Supplier', 'End User', 'Sales', 'Executive/Officer', 'Singapore', 'North Region', 'Singapore', 'No Current Relationship', 'Contacted', 'Cold Call', 'Low', ['Internet Service'], []],
  ['Nurul Huda', 'Operations Manager', 'Klang Valley Networks Sdn Bhd', 'Operations', 'kvnetworks', 'Telecom', 'Customer', 'ISP/Telco', 'Operations', 'Manager', 'Petaling Jaya', 'Selangor', 'Malaysia', 'Existing Customer', 'Won', 'Referral', 'High', ['Fiber/OSP', 'Maintenance'], ['key-account']],
  ['Lim Chee Keong', 'General Manager', 'Petaling Build Sdn Bhd', 'Management', 'petalingbuild', 'Construction', 'Partner', 'General Contractor', 'Management', 'Manager', 'Shah Alam', 'Selangor', 'Malaysia', 'Partner', 'Qualified', 'Exhibition', 'Medium', ['Structured Cabling', 'CCTV'], []],
  ['Kavitha Raman', 'Quality Engineer', 'Penang Precision Manufacturing', 'Quality', 'penangprecision', 'Manufacturing', 'Prospect', 'Manufacturer', 'Engineering', 'Staff', 'Bayan Lepas', 'Penang', 'Malaysia', 'New Lead', 'New', 'LinkedIn', 'Low', ['Network'], []],
  ['Hafiz Ismail', 'Sales Director', 'Johor Smart Homes', 'Sales', 'johorsmart', 'Real Estate', 'Prospect', 'Developer', 'Sales', 'Director', 'Johor Bahru', 'Johor', 'Malaysia', 'Active Prospect', 'Proposal Sent', 'Website', 'High', ['Smart Home', 'Wi-Fi'], ['township']],
  ['Tan Mei Ling', 'IT Officer', 'Selangor State IT Unit', 'IT', 'selangor.gov', 'Government', 'Government', 'End User', 'IT', 'Executive/Officer', 'Shah Alam', 'Selangor', 'Malaysia', 'No Current Relationship', 'Contacted', 'Cold Call', 'Medium', ['Network', 'Firewall'], ['tender']],
  ['Farah Zainal', 'Registrar', 'Putra Education Group', 'Administration', 'putraedu', 'Education', 'Prospect', 'End User', 'Admin', 'Manager', 'Kuala Lumpur', 'Federal Territory', 'Malaysia', 'New Lead', 'New', 'Referral', 'Medium', ['Wi-Fi'], ['campus']],
  ['Raj Pillai', 'CEO', 'Ipoh Logistics Sdn Bhd', '', 'ipohlogistics', 'Logistics', 'Prospect', 'End User', 'Owner/CEO', 'C-Level', 'Ipoh', 'Perak', 'Malaysia', 'Active Prospect', 'Qualified', 'Personal Introduction', 'High', ['CCTV', 'Network'], ['decision-maker']],
  ['Chong Wai Kit', 'Project Manager', 'Borneo Towers Engineering', 'Projects', 'borneotowers', 'Construction', 'Contractor', 'Subcontractor', 'Project Management', 'Manager', 'Kota Kinabalu', 'Sabah', 'Malaysia', 'Former Customer', 'Dormant', 'Existing Customer', 'Low', ['Fiber/OSP'], []],
  ['Aisyah Rahman', 'Retail Operations Lead', 'KL Mart Retail', 'Operations', 'klmart', 'Retail', 'Prospect', 'End User', 'Operations', 'Supervisor', 'Kuala Lumpur', 'Federal Territory', 'Malaysia', 'New Lead', 'Contacted', 'Exhibition', 'Medium', ['CCTV', 'Wi-Fi'], ['retail-chain']],
  ['Joel Fernandez', 'Senior Account Manager', 'Archipelago Telecom Supply', 'Sales', 'archtelsupply', 'Telecom', 'Supplier', 'Distributor', 'Sales', 'Manager', 'Pasay', 'Metro Manila', 'Philippines', 'Partner', 'Won', 'Supplier', 'Medium', [], ['supplier']],
  ['Bea Soriano', 'HR & Admin Head', 'Quezon Coworking Hub', 'Admin', 'qchub', 'Real Estate', 'Customer', 'End User', 'Admin', 'Manager', 'Quezon City', 'Metro Manila', 'Philippines', 'Existing Customer', 'Won', 'Website', 'Low', ['Internet Service', 'Smart Office'], []],
  ['Victor Ramos', 'Electrical Contractor', 'Ramos Electrical Works', '', 'ramoselectric', 'Construction', 'Contractor', 'Subcontractor', 'Owner/CEO', 'Owner', 'Antipolo', 'Rizal', 'Philippines', 'Partner', 'Qualified', 'Referral', 'Medium', ['Structured Cabling'], ['subcon']],
  ['Melissa Chan', 'Solutions Architect', 'Harbourfront Cloud Pte Ltd', 'Solutions', 'harbourcloud', 'IT', 'Partner', 'System Integrator', 'IT', 'Manager', 'Singapore', 'Central Region', 'Singapore', 'Partner', 'Contacted', 'LinkedIn', 'Medium', ['Network', 'Firewall'], []],
  ['Eduardo Lim', 'Plant Manager', 'Laguna Packaging Industries', 'Plant', 'lagunapack', 'Manufacturing', 'Prospect', 'End User', 'Operations', 'Manager', 'Calamba', 'Laguna', 'Philippines', 'New Lead', 'New', 'Cold Call', 'Medium', ['CCTV', 'Network'], ['factory']],
  ['Nadia Yusof', 'Hotel IT Executive', 'Langkawi Bay Resort', 'IT', 'langkawibay', 'Hospitality', 'Customer', 'End User', 'IT', 'Executive/Officer', 'Langkawi', 'Kedah', 'Malaysia', 'Existing Customer', 'Won', 'Referral', 'Low', ['Wi-Fi'], ['hotel']],
  ['Sean Villareal', 'Business Development', 'Cavite Industrial Estates', 'Business Development', 'caviteestates', 'Real Estate', 'Prospect', 'Developer', 'Sales', 'Executive/Officer', 'General Trias', 'Cavite', 'Philippines', 'Active Prospect', 'Contacted', 'Exhibition', 'Medium', ['Fiber/OSP', 'Internet Service'], ['industrial-park']],
  ['Lorna Fajardo', 'Treasury Officer', 'Visayan Rural Bank', 'Treasury', 'visayanrural', 'Banking', 'Prospect', 'End User', 'Finance', 'Staff', 'Bacolod', 'Negros Occidental', 'Philippines', '', '', '', '', [], []],
  ['Gabriel Uy', 'Founder', 'Uy Smart Living', '', 'uysmart', 'Proptech', 'Partner', 'Developer', 'Owner/CEO', 'Owner', 'Mandaue', 'Cebu', 'Philippines', 'Partner', 'Qualified', 'Personal Introduction', 'Medium', ['Smart Home'], ['startup']],
];

const PHONE_PREFIX = { Philippines: ['+63 917', '+63 2 8'], Singapore: ['+65 9', '+65 6'], Malaysia: ['+60 12', '+60 3'] };

function phoneFor(country, i, kind) {
  const [mobile, office] = PHONE_PREFIX[country];
  const n = String(1000 + ((i * 7919 + (kind === 'office' ? 333 : 0)) % 9000));
  return kind === 'office' ? `${office}55 ${n}` : `${mobile} 555 ${n}`;
}

function emailFor(name, domain) {
  const parts = name.toLowerCase().replace(/[^a-z ]/g, '').split(' ');
  return `${parts[0]}.${parts[parts.length - 1]}@${domain}.example.com`;
}

function iso(dateStr, hour = 9) {
  return `${dateStr}T${String(hour).padStart(2, '0')}:15:00`;
}

/** Build the seed relative to `today` so the date filters always have data. */
export function buildContacts(today = toISODate(new Date())) {
  const createdOffsets = [0, 0, -1, -2, -3, -5, -8, -12, -15, -20, -26, -33, -40, -47, -55, -61, -70, -78, -85, -93, -101, -110, -118, -126, -135, -144, -150, -158, -165, -172, -180, -190, -199, -210, -222, -235, -248, -260, -275, -290];
  const createdAt = (i) => createdOffsets[i] ?? -300 - i * 7;
  const lastOffsets = [0, -2, -5, null, -9, -14, -21, null, -40, -3, -60, -250, -18, null, -1, -7, -11, -4, -32, -6, -95, null, -120, -8, -27, null, -16, -200, null, -10, -300, null, -45, -70, -13, -24, null, -88, null, -35];
  const followOffsets = [7, -3, 2, 0, null, -10, null, 30, 0, 5, null, null, 14, null, 21, null, -1, 3, null, -5, 60, null, null, 10, null, 1, -2, null, 0, 4, null, null, 45, null, 12, null, 9, null, null, 6];
  const owners = (i) => (i === 3 ? 'u-maria' : ME); // cards are owner-only; Maria's one is offered to Alex

  return P.map((p, i) => {
    const [full_name, job_title, company, department, domain, industry, contact_type, business_category,
      job_function, seniority, city, region, country, relationship, lead_status, lead_source, priority,
      opportunities, tags] = p;
    const id = `c-${String(i + 1).padStart(3, '0')}`;
    const created = addDays(today, createdAt(i));
    const phones = [{ label: 'Mobile', number: phoneFor(country, i, 'mobile') }];
    if (i % 3 !== 2) phones.push({ label: i % 4 === 0 ? 'Direct' : 'Office', number: phoneFor(country, i, 'office') });
    const website = `www.${domain}.example.com`;
    const address = `${10 + ((i * 37) % 280)} ${['Ayala Avenue', 'Raffles Place', 'Jalan Ampang', 'Shaw Boulevard', 'Orchard Road', 'Jalan Sultan Ismail', 'Ortigas Avenue', 'Anson Road'][i % 8]}, ${city}`;
    const email = emailFor(full_name, domain);
    return {
      id,
      workspace_id: 'w-north',
      created_by: owners(i),
      is_private: true,
      full_name, job_title, company, department: department || null,
      emails: [email],
      phones,
      website,
      address,
      city, region, country,
      card_text: `${company}\n${full_name}\n${job_title}\n${address}\n${phones.map((x) => x.number).join(' / ')}\n${email}\n${website}`,
      contact_type, industry, business_category, job_function, seniority,
      opportunities, tags,
      relationship: relationship || null,
      lead_status: lead_status || null,
      lead_source: lead_source || null,
      priority: priority || null,
      last_contacted_on: lastOffsets[i] == null ? null : addDays(today, Math.max(lastOffsets[i], createdAt(i))),
      next_follow_up_on: followOffsets[i] == null ? null : addDays(today, followOffsets[i]),
      notes: i % 4 === 0 ? `Met at the ${['Manila Telco Expo', 'Singapore Smart Building Week', 'KL Network Summit'][i % 3]}. Interested in a site survey.` : null,
      front_path: `demo/${id}/front.svg`,
      back_path: i % 3 === 0 ? `demo/${id}/back.svg` : null,
      created_at: iso(created, 8 + (i % 9)),
      updated_at: iso(created, 8 + (i % 9)),
    };
  });
}

export function buildHarbourContacts(today = toISODate(new Date())) {
  return [
    ['Oscar Yap', 'Fibre Planner', 'Harbour Fibre Co', 'Telecom', 'Singapore', 'Singapore'],
    ['Lina Wong', 'Procurement Lead', 'Sentosa Marine Services', 'Logistics', 'Singapore', 'Singapore'],
    ['Imran Shah', 'Site Supervisor', 'Changi Civil Works', 'Construction', 'Singapore', 'Singapore'],
  ].map(([full_name, job_title, company, industry, city, country], i) => ({
    id: `h-${i + 1}`, workspace_id: 'w-harbour', created_by: ME, is_private: true,
    full_name, job_title, company, department: null,
    emails: [emailFor(full_name, company.toLowerCase().split(' ')[0])], phones: [{ label: 'Mobile', number: `+65 9555 ${2100 + i * 13}` }],
    website: null, address: null, city, region: null, country, card_text: null,
    contact_type: 'Prospect', industry, business_category: null, job_function: null, seniority: null,
    opportunities: [], tags: [], relationship: 'New Lead', lead_status: 'New', lead_source: 'Exhibition', priority: 'Medium',
    last_contacted_on: null, next_follow_up_on: null, notes: null,
    front_path: `demo/h-${i + 1}/front.svg`, back_path: null,
    created_at: iso(addDays(today, -20 * (i + 1))), updated_at: iso(addDays(today, -20 * (i + 1))),
  }));
}

export function buildInteractions(today = toISODate(new Date())) {
  return [
    {
      id: 'i-1', contact_id: 'c-002', workspace_id: 'w-north', created_by: ME, kind: 'Meeting',
      occurred_on: addDays(today, -2), title: 'Core network refresh: commercial terms',
      notes: 'Ramon wants the firewall cluster quoted separately. Budget approval goes to the board next month.',
      transcript: 'Ramon: We like the design, but finance wants the firewall pair as a separate line so we can phase it.\nAlex: That works. We can hold pricing for sixty days.\nRamon: Good. Send me the revised quote by Friday and we will take it to the board.',
      summary: 'Luzon Fiber accepts the proposed core network design but wants the firewall pair quoted as a separate, phased line item. Pricing will be held for 60 days. Ramon will present the revised quote to the board next month, so the deal is in negotiation with a clear decision path.',
      action_items: ['Send revised quote with firewall as a separate line by Friday', 'Confirm 60-day price hold in writing', 'Prepare one-page board summary for Ramon'],
      audio_path: 'demo-audio/i-1.wav', duration_sec: 1342,
      created_at: iso(addDays(today, -2), 15), updated_at: iso(addDays(today, -2), 15),
    },
    {
      id: 'i-2', contact_id: 'c-002', workspace_id: 'w-north', created_by: 'u-maria', kind: 'Call',
      occurred_on: addDays(today, -9), title: 'Intro call', notes: 'Asked for references from other ISPs. Sent the Merlion case study.',
      transcript: null, summary: null, action_items: [], audio_path: null, duration_sec: null,
      created_at: iso(addDays(today, -9), 10), updated_at: iso(addDays(today, -9), 10),
    },
    {
      id: 'i-3', contact_id: 'c-002', workspace_id: 'w-north', created_by: ME, kind: 'Note',
      occurred_on: addDays(today, -12), title: null, notes: 'Prefers WhatsApp over email for quick questions.',
      transcript: null, summary: null, action_items: [], audio_path: null, duration_sec: null,
      created_at: iso(addDays(today, -12), 11), updated_at: iso(addDays(today, -12), 11),
    },
    {
      id: 'i-4', contact_id: 'c-004', workspace_id: 'w-north', created_by: ME, kind: 'Site visit',
      occurred_on: addDays(today, -5), title: 'BGC tower riser walk-through',
      notes: 'Risers on floors 12–30 have space for two new cable trays. CCTV head-end to sit in the B1 MDF.',
      transcript: null, summary: 'Walk-through confirmed riser capacity for the structured cabling scope and agreed the CCTV head-end location. Proposal can now be finalised.',
      action_items: ['Update BOQ with tray quantities', 'Send proposal v2'], audio_path: null, duration_sec: null,
      created_at: iso(addDays(today, -5), 14), updated_at: iso(addDays(today, -5), 14),
    },
    {
      id: 'i-5', contact_id: 'c-015', workspace_id: 'w-north', created_by: ME, kind: 'Email',
      occurred_on: addDays(today, -1), title: 'Maintenance renewal', notes: 'Sent renewal pricing for the 3-year maintenance contract.',
      transcript: null, summary: null, action_items: [], audio_path: null, duration_sec: null,
      created_at: iso(addDays(today, -1), 9), updated_at: iso(addDays(today, -1), 9),
    },
    {
      id: 'i-6', contact_id: 'c-020', workspace_id: 'w-north', created_by: 'u-maria', kind: 'Message',
      occurred_on: addDays(today, -6), title: 'Pricing follow-up', notes: 'Siew Ling asked for an updated fibre route map before the negotiation call.',
      transcript: null, summary: null, action_items: ['Send route map'], audio_path: null, duration_sec: null,
      created_at: iso(addDays(today, -6), 16), updated_at: iso(addDays(today, -6), 16),
    },
  ];
}
