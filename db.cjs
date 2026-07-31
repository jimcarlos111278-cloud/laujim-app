// New installations start empty. Production data lives in PostgreSQL, never in
// the frontend bundle or committed seed credentials.
const INITIAL_DATA = {
  users: [],
  apartments: [],
  tenants: [],
  contracts: [],
  payments: [],
  expenses: [],
  utilityPayments: [],
  vacancies: [],
  familyMembers: [],
  settings: [],
  passwords: [],
  photos: [],
  messages: [],
  presence: [],
  leads: [],
  authSessions: [],
};

module.exports = { INITIAL_DATA };
