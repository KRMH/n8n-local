// S1 Send - "Render" node (Code, JavaScript, Run Once for All Items)
// English only. To change a wording, edit the text in MESSAGES.
const MESSAGES = {
  "welcome": "Welcome {name}. Send me what you see in a chalet, for example: chalet 12 heater broken. Start with ! for urgent. Send help for all commands.",
  "welcome_owner": "Welcome {name}. Employees' reports arrive here. Send help for all commands.",
  "not_allowed": "You are not allowed to do that.",
  "unsupported": "I can only read text and photos.",
  "bad_chalet": "Chalet number must be between 1 and {max}.",
  "report_received": "Received #{no}.",
  "report_forward": "#{no} from {name}, chalet {chalet}:\n{text}",
  "report_forward_urgent": "URGENT #{no} from {name}, chalet {chalet}:\n{text}",
  "owner_help": "Commands: @name text | @12 text | @all text | close #17 | open | left 12 | assign T5 name | start T5 | leave T5 | finish T5",
  "employee_help": "Send a message to report a problem (start with ! for urgent). Commands: left 12 | start T5 | leave T5 | finish T5 | assign T5 name | tasks | help",
  "unknown_person": "I do not know anyone called {name}.",
  "ambiguous_person": "More than one match for {name}: {names}. Use the full name.",
  "nobody_at_chalet": "Nobody is working at chalet {chalet}. Send it with @all or @name instead.",
  "from_owner": "Message from the owner:\n{text}",
  "delivered": "Delivered to {count}: {names}.",
  "unreachable_note": "Not reached (they have not started the bot): {names}.",
  "no_such_report": "There is no report #{no}.",
  "already_closed": "Report #{no} is already closed.",
  "report_closed": "Report #{no} is closed.",
  "ok": "Done.",
  "task_new": "Guests left chalet {chalet}. Cleaning task T{no} is pending. Send start T{no} to take it.",
  "task_new_others": "Other open tasks at chalet {chalet}: {list}.",
  "task_assigned": "You were given cleaning task T{no} (chalet {chalet}) by {name}.",
  "task_started": "{name} started T{no} (chalet {chalet}).",
  "task_left": "{name} left T{no} (chalet {chalet}).",
  "task_done": "T{no} (chalet {chalet}) is done, finished by {name}.",
  "which_task": "Chalet {chalet} has several open tasks: {list}. Repeat with the task number, for example start T5.",
  "no_open_task": "There is no open task at chalet {chalet}.",
  "no_such_task": "There is no task T{no}.",
  "task_closed": "Task T{no} is already done.",
  "not_on_task": "You are not on T{no}. Send start T{no} first.",
  "person_unreachable": "{name} has not started the bot, so the message was not delivered.",
  "urgent_reminder": "Still open: {list}",
  "task_pending_reminder": "Still pending: {list}",
  "digest": "Good morning. Urgent open reports: {urgent}. Other open reports: {other}. Tasks: {tasks}.",
  "digest_empty": "Good morning. Nothing is open.",
  "did_you_mean": "Did you mean {command}? Send it again, or add a few words if it was a report."
};

const t = $('When Executed by Another Workflow').first().json;
let text = MESSAGES[t.key] ?? `[missing message: ${t.key}]`;
const params = t.params || {};
// Parse mode is HTML, so user-supplied values must not contain raw < > &.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
text = text.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? esc(params[k]) : m));

// Telegram allows 4096 characters per message; split long text at line breaks.
const chunks = [];
while (text.length > 4000) {
  let cut = text.lastIndexOf('\n', 4000);
  if (cut < 1) cut = 4000;
  chunks.push(text.slice(0, cut));
  text = text.slice(cut).replace(/^\n/, '');
}
chunks.push(text);

return chunks.map(c => ({ json: { to: String(t.to), text: c, ref: t.ref || '' } }));
