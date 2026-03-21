-- ─────────────────────────────────────────────────────────────────────────────
-- Seed Data
-- Runs after first admin signup. The handle_new_user trigger must have fired
-- to create the profile row before this can run.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  seed_user_id UUID;
BEGIN
  IF (SELECT COUNT(*) FROM public.servers) > 0 THEN
    RAISE NOTICE 'Servers already seeded — skipping.';
    RETURN;
  END IF;

  SELECT id INTO seed_user_id FROM public.profiles LIMIT 1;
  IF seed_user_id IS NULL THEN
    RAISE NOTICE 'No profile found — sign up first, then re-run this migration.';
    RETURN;
  END IF;

  INSERT INTO public.servers (
    name, display_name, description, long_description, author_id,
    version, endpoint, github_url, tags, tools,
    status, verified, stars, total_calls, calls_today,
    latency_ms, uptime_pct, trust_score, scan_status, scan_issues,
    schema_hash, last_scanned_at
  ) VALUES
  (
    'stripe-payments', 'Stripe Payments',
    'Accept payments, manage subscriptions, issue refunds, and query transaction history.',
    'Full Stripe API coverage for AI agents. Charge cards, manage customers, handle subscriptions, process refunds.',
    seed_user_id, '2.1.0', 'https://mcp.stripe-payments.dev', 'https://github.com/community/stripe-mcp',
    ARRAY['payments','finance','billing','stripe'],
    ARRAY['charge_card','create_subscription','issue_refund','list_transactions','create_customer','create_invoice'],
    'active', TRUE, 4821, 3840000, 128400, 42, 99.98, 97.00, 'passed', '[]',
    encode(sha256('stripe-payments-2.1.0'::bytea), 'hex'), NOW()
  ),
  (
    'github-ops', 'GitHub Ops',
    'Create repos, manage issues, open pull requests, read code, and trigger CI/CD pipelines.',
    'Complete GitHub API integration for autonomous agents. Repo management, issues, PRs, code reading, branch operations, Actions triggering.',
    seed_user_id, '1.8.3', 'https://mcp.github-ops.dev', 'https://github.com/community/github-mcp',
    ARRAY['git','devops','code','github'],
    ARRAY['create_repo','open_pr','list_issues','read_file','trigger_workflow','create_branch','merge_pr'],
    'active', TRUE, 7203, 10240000, 341200, 61, 99.95, 96.00, 'passed', '[]',
    encode(sha256('github-ops-1.8.3'::bytea), 'hex'), NOW()
  ),
  (
    'postgres-query', 'Postgres Query',
    'Natural language to SQL. Query, insert, update Postgres databases with schema introspection.',
    'Full PostgreSQL access for agents. Schema introspection, safe query validation, transaction support, migration management.',
    seed_user_id, '3.0.0', 'https://mcp.postgres-query.dev', NULL,
    ARRAY['database','sql','postgres','data'],
    ARRAY['query','insert','update','delete','describe_schema','run_migration'],
    'active', TRUE, 3409, 2678000, 89300, 55, 99.91, 94.00, 'passed', '[]',
    encode(sha256('postgres-query-3.0.0'::bytea), 'hex'), NOW()
  ),
  (
    'browserbase', 'Browserbase',
    'Cloud browser automation. Navigate pages, extract data, fill forms, take screenshots.',
    'Full browser control via managed cloud fleet. Navigation, interaction, form filling, screenshot capture, content extraction.',
    seed_user_id, '2.0.1', 'https://mcp.browserbase.io', 'https://github.com/browserbase/mcp-server',
    ARRAY['browser','scraping','automation','web'],
    ARRAY['navigate','click','extract_text','screenshot','fill_form','wait_for_element'],
    'active', TRUE, 5566, 6030000, 201000, 210, 99.70, 93.00, 'passed', '[]',
    encode(sha256('browserbase-2.0.1'::bytea), 'hex'), NOW()
  ),
  (
    'sendgrid-mail', 'SendGrid Mail',
    'Send transactional and marketing emails, manage templates, track delivery metrics.',
    NULL, seed_user_id, '1.2.0', 'https://mcp.sendgrid-mail.dev', NULL,
    ARRAY['email','marketing','notifications'],
    ARRAY['send_email','create_template','list_campaigns','get_delivery_stats'],
    'active', FALSE, 2187, 1623000, 54100, 73, 99.82, 82.00, 'passed', '[]',
    encode(sha256('sendgrid-mail-1.2.0'::bytea), 'hex'), NOW()
  ),
  (
    'slack-messenger', 'Slack Messenger',
    'Post messages, manage channels, read history, and handle events in Slack workspaces.',
    NULL, seed_user_id, '1.5.0', 'https://mcp.slack-messenger.dev', NULL,
    ARRAY['slack','messaging','notifications','team'],
    ARRAY['post_message','create_channel','list_channels','read_history','add_reaction'],
    'active', TRUE, 3891, 4120000, 137300, 38, 99.93, 95.00, 'passed', '[]',
    encode(sha256('slack-messenger-1.5.0'::bytea), 'hex'), NOW()
  ),
  (
    'filesystem-ops', 'Filesystem Ops',
    'Read, write, and manage files and directories with path safety and permission controls.',
    NULL, seed_user_id, '2.3.1', 'https://mcp.filesystem-ops.dev', NULL,
    ARRAY['filesystem','files','storage','io'],
    ARRAY['read_file','write_file','list_directory','create_directory','delete_file','copy_file'],
    'active', TRUE, 6102, 8900000, 296700, 8, 100.00, 99.00, 'passed', '[]',
    encode(sha256('filesystem-ops-2.3.1'::bytea), 'hex'), NOW()
  );

  RAISE NOTICE 'Seeded 7 servers successfully.';
END $$;
