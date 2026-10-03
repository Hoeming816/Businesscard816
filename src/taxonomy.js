// Standard value lists shared by filters, forms and the AI scanner.
// Edit here, then run `npm run sync:taxonomy` so the scan-card edge function
// picks up the same lists (it reads supabase/functions/_shared/taxonomy.js).

export const CONTACT_TYPES = [
  'Customer', 'Prospect', 'Supplier', 'Vendor', 'Partner',
  'Consultant', 'Contractor', 'Government', 'Personal',
];

export const INDUSTRIES = [
  'Telecom', 'IT', 'Construction', 'Real Estate', 'Hospitality', 'Banking',
  'Manufacturing', 'Retail', 'Healthcare', 'Education', 'Government', 'Logistics',
];

export const BUSINESS_CATEGORIES = [
  'System Integrator', 'ISP/Telco', 'Distributor', 'Manufacturer', 'Developer',
  'General Contractor', 'Subcontractor', 'Consultant', 'End User',
];

export const JOB_FUNCTIONS = [
  'Owner/CEO', 'Management', 'Procurement', 'IT', 'Engineering', 'Sales',
  'Finance', 'Operations', 'Project Management', 'Admin',
];

export const SENIORITIES = [
  'Owner', 'C-Level', 'Director', 'Manager', 'Supervisor', 'Executive/Officer', 'Staff',
];

export const RELATIONSHIPS = [
  'Existing Customer', 'Active Prospect', 'New Lead', 'Former Customer',
  'Partner', 'No Current Relationship',
];

export const LEAD_STATUSES = [
  'New', 'Contacted', 'Qualified', 'Proposal Sent', 'Negotiating', 'Won', 'Lost', 'Dormant',
];

export const OPPORTUNITIES = [
  'Fiber/OSP', 'Structured Cabling', 'CCTV', 'Wi-Fi', 'Network', 'Firewall',
  'Smart Home', 'Smart Office', 'Internet Service', 'Maintenance',
];

export const LEAD_SOURCES = [
  'Referral', 'Exhibition', 'Website', 'Cold Call', 'LinkedIn',
  'Existing Customer', 'Supplier', 'Personal Introduction',
];

export const PRIORITIES = ['High', 'Medium', 'Low'];

export const PHONE_LABELS = ['Mobile', 'Office', 'Direct', 'Fax', 'Other'];

export const INTERACTION_KINDS = ['Meeting', 'Call', 'Site visit', 'Email', 'Message', 'Note'];

// Asked when a meeting recording starts; `focus` steers what the AI minutes concentrate on.
export const MEETING_TYPES = [
  { value: 'General Meeting', focus: 'Topics, decisions, actions' },
  { value: 'Management Meeting', focus: 'Decisions, risks, KPIs, approvals' },
  { value: 'Project Meeting', focus: 'Progress, issues, delays, actions' },
  { value: 'Sales Meeting', focus: 'Customer needs, opportunities, follow-ups' },
  { value: 'Technical Meeting', focus: 'Problems, solutions, technical decisions' },
  { value: 'Site Meeting', focus: 'Site issues, manpower, materials, schedule' },
  { value: 'Client Meeting', focus: 'Requirements, commitments, decisions' },
  { value: 'Brainstorming', focus: 'Ideas, suggestions, conclusions' },
  { value: 'Interview', focus: 'Questions, answers, candidate information' },
];

export const ACTION_PRIORITIES = ['High', 'Medium', 'Low'];
export const ACTION_STATUSES = ['Open', 'Done'];

export const LAST_CONTACT_BUCKETS = ['Today', '7 Days', '30 Days', '90 Days', '6+ Months', 'Never Contacted'];

export const FOLLOW_UP_BUCKETS = ['Follow-up Due', 'Follow-up Today', 'Upcoming', 'Overdue', 'No Follow-up'];

export const DATE_ADDED_BUCKETS = ['Today', 'This Week', 'This Month', 'Custom Range'];

export const SPEECH_LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-PH', label: 'English (Philippines)' },
  { code: 'en-SG', label: 'English (Singapore)' },
  { code: 'fil-PH', label: 'Filipino' },
  { code: 'ms-MY', label: 'Malay' },
  { code: 'zh-CN', label: 'Mandarin' },
  { code: 'id-ID', label: 'Indonesian' },
];

// Single-value classification fields on a contact, keyed by column name.
export const CLASSIFICATION_FIELDS = {
  contact_type: { label: 'Contact Type', values: CONTACT_TYPES },
  industry: { label: 'Industry', values: INDUSTRIES },
  business_category: { label: 'Business Category', values: BUSINESS_CATEGORIES },
  job_function: { label: 'Job Function', values: JOB_FUNCTIONS },
  seniority: { label: 'Seniority', values: SENIORITIES },
  relationship: { label: 'Relationship', values: RELATIONSHIPS },
  lead_status: { label: 'Lead Status', values: LEAD_STATUSES },
  lead_source: { label: 'Lead Source', values: LEAD_SOURCES },
  priority: { label: 'Priority', values: PRIORITIES },
};
