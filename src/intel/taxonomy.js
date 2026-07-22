/**
 * taxonomy.js — Phase 5 capability knowledge base (ADDITIVE, mechanical).
 *
 * A curated catalog of software CAPABILITIES (what a subsystem *does* / *why* it
 * exists) with the concrete signals that let us recognize each one in a real
 * repository. The Domain Discovery Engine (capabilities.js) matches these signals
 * against the static-analysis index; nothing here invents features. A capability
 * is only surfaced when real evidence (files, routes, tables, deps, symbols)
 * supports it, and every match carries its evidence + a confidence.
 *
 * kind:
 *   business        a product capability users care about (Auth, Payroll, Search)
 *   integration     talks to an external system (email, payments, cloud, webhooks)
 *   infrastructure  operational plumbing (deploy, jobs, migrations, storage)
 *   cross-cutting   a concern spread across the app (logging, caching, config)
 *   technical       an internal software layer (API layer, data access, utils)
 *
 * Signals (all optional per entry):
 *   name    tokens matched against file/dir/function/class basenames (strong)
 *   route   substrings matched against HTTP route paths
 *   table   substrings matched against DB table names
 *   dep     dependency package-name substrings (ecosystem-agnostic)
 *   symbol  substrings matched against function/class names (weaker than name)
 *   env     substrings matched against environment-variable names
 */

// Each capability: { id, label, kind, why, signals:{...}, users? }
export const CAPABILITIES = [
  // ---------------- business capabilities ----------------
  { id:'auth', label:'Authentication & Authorization', kind:'business',
    why:'Verifies who a user is and what they are allowed to do.',
    users:['end users','administrators'],
    signals:{ name:['auth','login','logout','signin','signup','register','session','oauth','jwt','token','password','credential','permission','role','rbac','acl','identity','sso','mfa','otp'],
      route:['login','logout','auth','signin','signup','register','oauth','token','session'],
      table:['user','users','account','session','role','permission','token','credential'],
      dep:['passport','bcrypt','jsonwebtoken','jwt','oauth','authlib','devise','pyjwt','argon2','otp','firebase-auth','next-auth','auth0'],
      symbol:['authenticate','authorize','login','logout','signin','signup','hashpassword','verifypassword','issuetoken','requirelogin','checkpermission'],
      env:['secret','jwt','oauth','client_id','client_secret','session'] } },

  { id:'user-mgmt', label:'User / Account Management', kind:'business',
    why:'Creates and maintains user accounts, profiles, and organizations.',
    users:['end users','administrators'],
    signals:{ name:['user','account','profile','member','organization','tenant','team','contact'],
      route:['user','account','profile','member','org','team'],
      table:['user','account','profile','member','organization','tenant','team'],
      symbol:['createuser','updateprofile','getuser','deleteaccount'] } },

  { id:'employee', label:'Employee / HR Management', kind:'business',
    why:'Manages employees, departments, and organizational HR data.',
    users:['HR staff','managers','employees'],
    signals:{ name:['employee','hr','staff','department','designation','manager','workforce','personnel'],
      route:['employee','hr','staff','department'],
      table:['employee','department','designation','staff'],
      symbol:['createemployee','getemployee','assigndepartment'] } },

  { id:'attendance', label:'Attendance & Time Tracking', kind:'business',
    why:'Records worked hours, check-ins, and time logs.',
    users:['employees','managers'],
    signals:{ name:['attendance','checkin','checkout','timesheet','clock','shift','punch','worklog'],
      route:['attendance','checkin','checkout','timesheet','clock'],
      table:['attendance','timesheet','shift','checkin','worklog'],
      symbol:['checkin','checkout','logattendance','markpresent'] } },

  { id:'leave', label:'Leave Management', kind:'business',
    why:'Handles time-off requests, approvals, and leave balances.',
    users:['employees','managers'],
    signals:{ name:['leave','vacation','pto','absence','holiday','timeoff'],
      route:['leave','vacation','pto','absence'],
      table:['leave','vacation','absence','holiday'],
      symbol:['requestleave','approveleave','leavebalance'] } },

  { id:'payroll', label:'Payroll & Compensation', kind:'business',
    why:'Computes salaries, deductions, and issues pay.',
    users:['finance staff','employees'],
    signals:{ name:['payroll','salary','payslip','wage','compensation','deduction','bonus','pay','earning','tax'],
      route:['payroll','salary','payslip','pay'],
      table:['payroll','salary','payslip','wage','deduction'],
      symbol:['computesalary','calculatepay','generatepayslip','applydeduction'] } },

  { id:'resume', label:'Resume / Document Processing', kind:'business',
    why:'Extracts structured information from uploaded resumes or documents.',
    users:['recruiters','candidates'],
    signals:{ name:['resume','cv','parser','extract','ocr','document','pdf','docx','candidate'],
      route:['resume','cv','upload','parse','document'],
      table:['resume','candidate','document','skill','experience'],
      dep:['pdf','docx','tesseract','pdfjs','mammoth','textract','spacy','pypdf'],
      symbol:['parseresume','extractskills','parsepdf','extracttext'] } },

  { id:'matching', label:'Matching / Recommendation Engine', kind:'business',
    why:'Ranks and matches items (jobs, candidates, products) to users.',
    users:['end users'],
    signals:{ name:['match','matching','recommend','recommendation','ranking','score','suggest','similarity','relevance'],
      route:['match','recommend','suggest'],
      table:['match','recommendation','score'],
      symbol:['recommend','matchscore','rankcandidates','computesimilarity'] } },

  { id:'search', label:'Search', kind:'business',
    why:'Lets users find records via queries, filters, and indexes.',
    users:['end users'],
    signals:{ name:['search','query','index','filter','elastic','lucene','solr','fulltext'],
      route:['search','query','find','filter'],
      dep:['elasticsearch','opensearch','meilisearch','algolia','whoosh','lunr','typesense','solr'],
      symbol:['search','query','buildindex','fulltextsearch'] } },

  { id:'payments', label:'Payments & Billing', kind:'business',
    why:'Processes payments, invoices, and subscriptions.',
    users:['customers','finance staff'],
    signals:{ name:['payment','checkout','cart','invoice','billing','subscription','pricing','wallet','transaction','refund','order'],
      route:['payment','checkout','cart','invoice','billing','subscribe','order'],
      table:['payment','invoice','order','transaction','subscription','cart'],
      dep:['stripe','braintree','paypal','razorpay','square','paddle','chargebee'],
      symbol:['charge','createcheckout','processpayment','refund','createinvoice'] } },

  { id:'notifications', label:'Notifications', kind:'business',
    why:'Delivers messages to users via email, SMS, or push.',
    users:['end users'],
    signals:{ name:['notification','notify','alert','email','mail','sms','push','reminder'],
      route:['notification','notify','alert'],
      table:['notification','alert','message'],
      dep:['nodemailer','sendgrid','mailgun','twilio','firebase-admin','ses','postmark','fcm'],
      symbol:['sendnotification','notify','sendemail','sendsms','pushnotification'] } },

  { id:'messaging', label:'Messaging / Chat', kind:'business',
    why:'Enables conversations, comments, or real-time chat.',
    users:['end users'],
    signals:{ name:['chat','message','messaging','conversation','comment','thread','inbox','dm'],
      route:['chat','message','conversation','comment','thread'],
      table:['message','conversation','chat','comment','thread'],
      dep:['socket.io','ws','pusher','ably','sendbird','stream-chat'],
      symbol:['sendmessage','postcomment','startconversation'] } },

  { id:'scheduling', label:'Scheduling & Calendar', kind:'business',
    why:'Manages bookings, appointments, and calendar events.',
    users:['end users'],
    signals:{ name:['schedule','scheduler','booking','reservation','calendar','appointment','availability','slot'],
      route:['schedule','booking','reservation','calendar','appointment'],
      table:['booking','reservation','appointment','event','slot'],
      symbol:['book','reserve','scheduleevent','checkavailability'] } },

  { id:'analytics', label:'Analytics & Reporting', kind:'business',
    why:'Aggregates data into dashboards, reports, and metrics.',
    users:['administrators','analysts'],
    signals:{ name:['analytics','report','reporting','dashboard','metric','stats','statistic','insight','chart','export','kpi'],
      route:['analytics','report','dashboard','metric','stats','export'],
      table:['report','metric','analytics','event','log'],
      dep:['chart.js','d3','recharts','plotly','pandas','matplotlib'],
      symbol:['generatereport','computemetric','aggregate','exportcsv'] } },

  { id:'learning', label:'Learning / Courses Engine', kind:'business',
    why:'Delivers courses, lessons, quizzes, and tracks progress.',
    users:['learners','instructors'],
    signals:{ name:['course','lesson','quiz','curriculum','learning','module','enroll','progress','certificate','exam'],
      route:['course','lesson','quiz','enroll','progress'],
      table:['course','lesson','quiz','enrollment','progress'],
      symbol:['enroll','submitquiz','trackprogress'] } },

  { id:'ai-features', label:'AI / ML Features', kind:'business',
    why:'Uses models or LLMs to power intelligent product features.',
    users:['end users'],
    signals:{ name:['ai','ml','model','predict','inference','embedding','llm','gpt','neural','classifier','vector'],
      route:['ai','ml','predict','generate','chat','complete'],
      dep:['openai','anthropic','langchain','transformers','tensorflow','torch','pytorch','scikit-learn','huggingface','cohere','ollama','llama'],
      symbol:['predict','embed','generate','classify','runinference','completion'] } },

  { id:'content', label:'Content Management', kind:'business',
    why:'Creates and manages posts, pages, or media content.',
    users:['editors','end users'],
    signals:{ name:['content','post','article','page','blog','cms','media','gallery','category','tag'],
      route:['post','article','page','blog','content','media'],
      table:['post','article','page','content','media','category','tag'],
      symbol:['createpost','publish','uploadmedia'] } },

  { id:'inventory', label:'Inventory / Catalog', kind:'business',
    why:'Tracks products, stock, and catalog data.',
    users:['staff','end users'],
    signals:{ name:['product','catalog','inventory','stock','warehouse','sku','item'],
      route:['product','catalog','inventory','stock'],
      table:['product','inventory','stock','catalog','sku'],
      symbol:['updatestock','addproduct','checkinventory'] } },

  { id:'admin', label:'Administration', kind:'business',
    why:'Back-office tools for managing the system and its data.',
    users:['administrators'],
    signals:{ name:['admin','administration','manage','backoffice','console','panel','moderation'],
      route:['admin','manage','moderation'],
      symbol:['adminonly','manageusers','moderate'] } },

  // ---------------- integration capabilities ----------------
  { id:'external-api', label:'External API Integrations', kind:'integration',
    why:'Calls third-party HTTP APIs to fetch or push data.',
    signals:{ name:['client','integration','connector','gateway','proxy','webhook','api','sdk','third','external'],
      dep:['axios','requests','httpx','got','node-fetch','okhttp','retrofit','feign','guzzle','faraday'],
      symbol:['fetch','httpget','httppost','callapi','request'] } },

  { id:'webhooks', label:'Webhooks', kind:'integration',
    why:'Receives or emits event callbacks to/from other systems.',
    signals:{ name:['webhook','hook','callback','event'],
      route:['webhook','hook','callback'],
      symbol:['handlewebhook','emitevent','onwebhook'] } },

  { id:'cloud', label:'Cloud Services', kind:'integration',
    why:'Uses managed cloud services (storage, compute, queues).',
    signals:{ name:['aws','gcp','azure','s3','lambda','cloud','bucket','blob'],
      dep:['aws-sdk','boto3','@google-cloud','azure','firebase','cloudinary','@aws-sdk'],
      env:['aws','gcp','azure','s3','bucket'] } },

  { id:'email-sms', label:'Email / SMS Providers', kind:'integration',
    why:'Sends transactional email or SMS via an external provider.',
    signals:{ name:['email','mail','smtp','sms'],
      dep:['nodemailer','sendgrid','mailgun','twilio','ses','postmark','mailchimp'],
      env:['smtp','sendgrid','twilio','mail'] } },

  // ---------------- infrastructure capabilities ----------------
  { id:'jobs', label:'Background Jobs & Queues', kind:'infrastructure',
    why:'Runs asynchronous work off the request path (cron, workers, queues).',
    signals:{ name:['job','worker','queue','cron','scheduler','task','celery','sidekiq','bull'],
      dep:['celery','sidekiq','bull','bullmq','agenda','rq','resque','kafka','rabbitmq','amqp'],
      symbol:['enqueue','process','runjob','schedule','worker'] } },

  { id:'storage', label:'File Storage & Uploads', kind:'infrastructure',
    why:'Stores and serves files, media, and uploads.',
    signals:{ name:['upload','download','file','storage','media','asset','attachment','bucket'],
      route:['upload','download','file','media','asset'],
      dep:['multer','multipart','cloudinary','s3','minio'],
      symbol:['upload','savefile','getfile','download'] } },

  { id:'migrations', label:'Database Migrations & Schema', kind:'infrastructure',
    why:'Defines and versions the database schema.',
    signals:{ name:['migration','migrate','schema','seed','alembic','flyway','liquibase'],
      dep:['alembic','flyway','liquibase','knex','sequelize','typeorm','prisma','gorm','django'],
      symbol:['migrate','createtable','addcolumn','seed'] } },

  { id:'deploy', label:'Deployment & CI/CD', kind:'infrastructure',
    why:'Builds, packages, and ships the application.',
    signals:{ name:['deploy','ci','cd','pipeline','dockerfile','docker','kubernetes','k8s','helm','terraform','workflow','build'],
      dep:[] } },

  { id:'monitoring', label:'Monitoring & Observability', kind:'infrastructure',
    why:'Tracks health, metrics, traces, and errors in production.',
    signals:{ name:['monitor','metrics','trace','telemetry','healthcheck','observ','prometheus'],
      dep:['prometheus','sentry','datadog','opentelemetry','newrelic','statsd','grafana'],
      symbol:['recordmetric','tracespan','healthcheck'] } },

  // ---------------- cross-cutting concerns ----------------
  { id:'caching', label:'Caching', kind:'cross-cutting',
    why:'Speeds up responses by storing computed/queried results.',
    signals:{ name:['cache','caching','redis','memcache','memoize'],
      dep:['redis','ioredis','memcached','node-cache','lru-cache'],
      env:['redis','cache'],
      symbol:['cache','getcached','memoize','invalidatecache'] } },

  { id:'logging', label:'Logging & Audit', kind:'cross-cutting',
    why:'Records events and an audit trail for debugging and compliance.',
    signals:{ name:['log','logger','logging','audit','trace','journal'],
      dep:['winston','pino','bunyan','log4j','logback','loguru','zap','logrus'],
      symbol:['log','logger','auditlog','logevent'] } },

  { id:'config', label:'Configuration & Feature Flags', kind:'cross-cutting',
    why:'Centralizes settings, environment config, and toggles.',
    signals:{ name:['config','settings','env','environment','feature','flag','toggle','option'],
      dep:['dotenv','viper','pydantic-settings','config','convict'],
      symbol:['loadconfig','getsetting','isenabled','featureflag'] } },

  { id:'validation', label:'Validation', kind:'cross-cutting',
    why:'Checks and sanitizes input data before use.',
    signals:{ name:['validate','validation','validator','schema','sanitize','serializer'],
      dep:['zod','joi','yup','pydantic','marshmallow','class-validator','cerberus','ajv'],
      symbol:['validate','sanitize','isvalid','checkinput'] } },

  { id:'security', label:'Security & Compliance', kind:'cross-cutting',
    why:'Protects the app: encryption, secrets, and safe-guards.',
    signals:{ name:['security','encrypt','crypto','hash','sanitize','csrf','cors','xss','ratelimit','firewall'],
      dep:['helmet','bcrypt','crypto','cryptography','cors','csurf','ratelimit'],
      symbol:['encrypt','decrypt','hash','sanitize','ratelimit'] } },

  { id:'i18n', label:'Internationalization', kind:'cross-cutting',
    why:'Adapts the app to multiple languages and locales.',
    signals:{ name:['i18n','l10n','locale','translation','gettext'],
      dep:['i18next','react-intl','gettext','formatjs','vue-i18n','polyglot'],
      symbol:['translate','setlocale','formatmessage','gettext'] } },

  // ---------------- technical layers ----------------
  { id:'api-layer', label:'API / Routing Layer', kind:'technical',
    why:'The HTTP surface: how the outside world enters the system.',
    signals:{ name:['route','router','controller','handler','endpoint','api','rest','graphql','view','resource'],
      dep:['express','fastify','koa','flask','django','fastapi','gin','fiber','rails','spring','laravel'],
      symbol:['route','handle','get','post','put','delete'] } },

  { id:'data-access', label:'Data Access Layer', kind:'technical',
    why:'Reads and writes the database; models and repositories.',
    signals:{ name:['model','entity','repository','dao','schema','orm','query','db','database','store'],
      dep:['sequelize','typeorm','prisma','mongoose','sqlalchemy','gorm','hibernate','activerecord','knex'],
      symbol:['find','save','update','delete','query','insert'] } },

  { id:'utils', label:'Shared Utilities & Helpers', kind:'technical',
    why:'Reusable building blocks used across the codebase.',
    signals:{ name:['util','utils','helper','helpers','common','shared','lib','core','misc','tool'],
      symbol:['format','parse','convert','clamp','debounce'] } },

  { id:'middleware', label:'Middleware / Interceptors', kind:'technical',
    why:'Cross-request processing: auth, logging, error handling in the pipeline.',
    signals:{ name:['middleware','interceptor','filter','guard','pipeline','decorator'],
      symbol:['middleware','intercept','beforerequest','afterrequest'] } },

  { id:'templating', label:'Views / Templating', kind:'technical',
    why:'Renders server-side HTML or UI templates.',
    signals:{ name:['template','view','render','layout','partial','component','page','ui'],
      dep:['jinja2','handlebars','ejs','pug','mustache','thymeleaf','erb','blade'],
      symbol:['render','template','renderview'] } },
];

// Keyword sets used to classify a domain's *kind* when no catalog entry matches.
export const KIND_HINTS = {
  infrastructure: ['config','settings','infra','deploy','docker','k8s','ci','cd','pipeline','script','build','bin','ops','devops','terraform'],
  technical: ['util','utils','helper','common','shared','core','lib','base','abstract','middleware','router','route','model','schema','type','types'],
  test: ['test','tests','spec','specs','__tests__','mock','fixture','e2e'],
};

// Signal weights: how strongly each signal contributes to a capability match.
export const SIGNAL_WEIGHTS = { name:3.0, route:2.5, table:2.5, dep:3.5, symbol:1.2, env:1.5 };

// Confidence wording from a normalized 0..1 score.
export function confidenceLabel(score){
  if(score>=0.75) return 'confident';
  if(score>=0.5) return 'likely';
  if(score>=0.28) return 'possibly';
  return 'low';
}
export function confidenceWord(score){
  if(score>=0.75) return '';         // stated plainly
  if(score>=0.5) return 'Likely';
  if(score>=0.28) return 'Possibly';
  return 'Unable to determine';
}
