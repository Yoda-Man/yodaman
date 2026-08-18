/**
 * LOAD-BEARING — DO NOT DELETE BECAUSE "NOTHING IMPORTS IT".
 *
 * React Native / Expo application entry. Resolved by the Expo runtime by
 * convention, not by any import from this repository. This app also has its
 * own package.json and node_modules, so its deps (expo, react-native) are
 * intentionally absent from the core package.json.
 *
 * The tabs mirror the desktop surface so the two clients teach the same model
 * of the product: the three-tool pillar (Context Expert, Graphify, OpenSpec)
 * is visible here too, not just on the desktop. Everything Stardust exposes on
 * mobile is read-only — the phone can watch specs and drift, but only the
 * approval gate mutates anything, and that already has its own confirmation.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { createYodaManClient } from './src/api/yodamanClient';
import { colors, fonts, radius, readout, statusColor } from './theme';
import {
  EmptyState,
  HudFrame,
  KeyValue,
  Mono,
  Pill,
  PrimaryButton,
  Readout,
  SecondaryButton,
  Section
} from './components';

const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:3090';

const TABS = [
  { id: 'connect', label: 'Connect' },
  { id: 'ask', label: 'Ask' },
  { id: 'stardust', label: 'Stardust' },
  { id: 'impact', label: 'Impact' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'approvals', label: 'Approvals' }
];

export default function App() {
  // ── Connection ──────────────────────────────────────────────────────────
  const [runtimeUrl, setRuntimeUrl] = useState(DEFAULT_RUNTIME_URL);
  const [pairingToken, setPairingToken] = useState('');
  const [status, setStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [connected, setConnected] = useState(false);

  // ── Workspace ───────────────────────────────────────────────────────────
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');

  // ── Ask / search ────────────────────────────────────────────────────────
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);

  // ── Stardust ────────────────────────────────────────────────────────────
  const [board, setBoard] = useState(null);
  const [drift, setDrift] = useState(null);
  const [diagnose, setDiagnose] = useState(null);

  // ── Impact ──────────────────────────────────────────────────────────────
  const [impactFile, setImpactFile] = useState('');
  const [impactDepth, setImpactDepth] = useState(2);
  const [compose, setCompose] = useState(null);

  // ── Tasks / approvals ───────────────────────────────────────────────────
  const [tasks, setTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [taskEvents, setTaskEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);

  const [tab, setTab] = useState('connect');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [runtimeNotice, setRuntimeNotice] = useState('');

  const client = useMemo(
    () => createYodaManClient(runtimeUrl, pairingToken),
    [runtimeUrl, pairingToken]
  );

  const run = useCallback(async (label, action) => {
    setBusy(true);
    setRuntimeNotice('');
    try {
      await action();
      setConnected(true);
    } catch (error) {
      const message = error.message || 'YodaMan could not complete the request.';
      setRuntimeNotice(message);
      setConnected(false);
      Alert.alert(label, message);
    } finally {
      setBusy(false);
    }
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────

  function connect() {
    run('Connection failed', async () => {
      const [statusResult, healthResult] = await Promise.all([client.status(), client.health()]);
      setStatus(statusResult);
      setHealth(healthResult);
      const projectList = await client.projects();
      const list = Array.isArray(projectList) ? projectList : [];
      setProjects(list);
      if (!selectedProjectId && list.length) {
        setSelectedProjectId(list[0].id || list[0].path || '');
      }
      const readinessResult = await client.readiness();
      setReadiness(readinessResult);
    });
  }

  function loadProjects() {
    run('Projects failed', async () => {
      const result = await client.projects();
      setProjects(Array.isArray(result) ? result : []);
    });
  }

  function parsePairingLink() {
    run('Pairing link failed', async () => {
      const value = runtimeUrl.trim();
      if (!value.startsWith('yodaman://pair')) {
        throw new Error('Paste a yodaman://pair link into the Runtime URL field first.');
      }
      const parsed = new URL(value);
      const nextUrl = parsed.searchParams.get('url');
      const nextToken = parsed.searchParams.get('token');
      if (!nextUrl || !nextToken) {
        throw new Error('Pairing link is missing url or token.');
      }
      setRuntimeUrl(nextUrl);
      setPairingToken(nextToken);
    });
  }

  function askYodaMan() {
    if (!question.trim()) return;
    run('Ask failed', async () => {
      const result = await client.ask(question.trim(), selectedProjectId || undefined);
      setAnswer(result.answer || JSON.stringify(result, null, 2));
    });
  }

  function searchWorkspace() {
    if (!query.trim()) return;
    run('Search failed', async () => {
      const result = await client.search(query.trim(), selectedProjectId || undefined);
      setSearchResults(result);
    });
  }

  function loadStardust() {
    run('Stardust failed', async () => {
      const root = selectedProjectId || undefined;
      const [boardResult, driftResult] = await Promise.all([
        client.stardustBoard(root),
        client.stardustDrift(root)
      ]);
      setBoard(boardResult);
      setDrift(driftResult);
    });
  }

  function loadDiagnostics() {
    run('Diagnostics failed', async () => {
      const [diagnoseResult, readinessResult] = await Promise.all([
        client.stardustDiagnose(selectedProjectId || undefined),
        client.readiness()
      ]);
      setDiagnose(diagnoseResult);
      setReadiness(readinessResult);
    });
  }

  function analyzeImpact() {
    if (!impactFile.trim()) return;
    run('Impact failed', async () => {
      const result = await client.stardustCompose(
        selectedProjectId || undefined,
        impactFile.trim(),
        impactDepth
      );
      setCompose(result);
    });
  }

  function loadTasks() {
    run('Tasks failed', async () => {
      const result = await client.tasks();
      const nextTasks = Array.isArray(result) ? result : [];
      setTasks(nextTasks);
      const nextSelectedTaskId = selectedTaskId || nextTasks[0]?.taskId || '';
      setSelectedTaskId(nextSelectedTaskId);
      if (nextSelectedTaskId) {
        const events = await client.taskEvents(nextSelectedTaskId);
        setTaskEvents(Array.isArray(events) ? events : []);
        setSelectedEvent(null);
      } else {
        setTaskEvents([]);
        setSelectedEvent(null);
      }
    });
  }

  function openTask(taskId) {
    run('Task events failed', async () => {
      setSelectedTaskId(taskId);
      const events = await client.taskEvents(taskId);
      setTaskEvents(Array.isArray(events) ? events : []);
      setSelectedEvent(null);
    });
  }

  function cancelTask(taskId) {
    run('Cancel failed', async () => {
      await client.cancel(taskId);
      await loadTasksInline();
    });
  }

  async function loadTasksInline() {
    const result = await client.tasks();
    setTasks(Array.isArray(result) ? result : []);
  }

  function loadApprovals() {
    run('Approvals failed', async () => {
      const result = await client.pendingApprovals();
      const approvals = Array.isArray(result) ? result : [];
      setPendingApprovals(approvals);
    });
  }

  function decideApproval(taskId, approved, label) {
    Alert.alert(
      approved ? 'Approve write?' : 'Reject write?',
      `${approved ? 'Approving' : 'Rejecting'} the proposed change to ${label}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: approved ? 'Approve' : 'Reject',
          style: approved ? 'default' : 'destructive',
          onPress: () =>
            run('Approval failed', async () => {
              await client.approve(taskId, approved);
              const result = await client.pendingApprovals();
              setPendingApprovals(Array.isArray(result) ? result : []);
            })
        }
      ]
    );
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (tab === 'connect') await client.status().then(setStatus).catch(() => {});
      if (tab === 'stardust') {
        await Promise.all([
          client.stardustBoard(selectedProjectId || undefined).then(setBoard).catch(() => {}),
          client.stardustDrift(selectedProjectId || undefined).then(setDrift).catch(() => {})
        ]);
      }
      if (tab === 'tasks') await loadTasksInline().catch(() => {});
      if (tab === 'approvals') {
        await client.pendingApprovals()
          .then((r) => setPendingApprovals(Array.isArray(r) ? r : []))
          .catch(() => {});
      }
    } finally {
      setRefreshing(false);
    }
  }, [tab, client, selectedProjectId]);

  const projectLabel = selectedProjectId
    ? selectedProjectId.split('/').filter(Boolean).pop()
    : 'no project';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bgPrimary} />

      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>YodaMan</Text>
            <Readout>Mobile companion</Readout>
          </View>
          <Pill
            label={connected ? 'Linked' : 'Offline'}
            tone={connected ? colors.jedi : colors.textFaint}
            dim={connected ? colors.jediDim : undefined}
          />
        </View>
        {selectedProjectId ? (
          <Text style={styles.projectChip} numberOfLines={1}>{projectLabel}</Text>
        ) : null}
      </View>

      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
          {TABS.map((t) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.id }}
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[styles.tab, tab === t.id ? styles.tabActive : null]}
            >
              <Text style={[styles.tabText, tab === t.id ? styles.tabTextActive : null]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              onRefresh={onRefresh}
              refreshing={refreshing}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
        >
          {runtimeNotice ? (
            <View style={styles.notice}>
              <Readout style={{ color: colors.sith }}>Runtime unavailable</Readout>
              <Text style={styles.noticeText}>{runtimeNotice}</Text>
              <Text style={styles.noticeHint}>
                Start the YodaMan desktop app on your computer, then confirm the runtime URL and
                pairing token on the Connect tab.
              </Text>
            </View>
          ) : null}

          {tab === 'connect' ? (
            <ConnectTab
              busy={busy}
              health={health}
              onConnect={connect}
              onLoadProjects={loadProjects}
              onPair={parsePairingLink}
              pairingToken={pairingToken}
              projects={projects}
              readiness={readiness}
              runtimeUrl={runtimeUrl}
              selectedProjectId={selectedProjectId}
              setPairingToken={setPairingToken}
              setRuntimeUrl={setRuntimeUrl}
              setSelectedProjectId={setSelectedProjectId}
              status={status}
            />
          ) : null}

          {tab === 'ask' ? (
            <AskTab
              answer={answer}
              busy={busy}
              onAsk={askYodaMan}
              onSearch={searchWorkspace}
              projectLabel={projectLabel}
              query={query}
              question={question}
              searchResults={searchResults}
              setQuery={setQuery}
              setQuestion={setQuestion}
            />
          ) : null}

          {tab === 'stardust' ? (
            <StardustTab
              board={board}
              busy={busy}
              diagnose={diagnose}
              drift={drift}
              onLoad={loadStardust}
              onLoadDiagnostics={loadDiagnostics}
              readiness={readiness}
            />
          ) : null}

          {tab === 'impact' ? (
            <ImpactTab
              busy={busy}
              compose={compose}
              depth={impactDepth}
              file={impactFile}
              onAnalyze={analyzeImpact}
              setDepth={setImpactDepth}
              setFile={setImpactFile}
            />
          ) : null}

          {tab === 'tasks' ? (
            <TasksTab
              busy={busy}
              events={taskEvents}
              onCancel={cancelTask}
              onLoad={loadTasks}
              onOpen={openTask}
              selectedEvent={selectedEvent}
              selectedTaskId={selectedTaskId}
              setSelectedEvent={setSelectedEvent}
              tasks={tasks}
            />
          ) : null}

          {tab === 'approvals' ? (
            <ApprovalsTab
              approvals={pendingApprovals}
              busy={busy}
              onDecide={decideApproval}
              onLoad={loadApprovals}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {busy ? (
        <View style={styles.busyBar}>
          <ActivityIndicator color={colors.accent} size="small" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────

function ConnectTab(props) {
  const {
    busy, health, onConnect, onLoadProjects, onPair, pairingToken, projects,
    readiness, runtimeUrl, selectedProjectId, setPairingToken, setRuntimeUrl,
    setSelectedProjectId, status
  } = props;

  return (
    <>
      <Section title="Runtime" hint="Point the app at the machine running YodaMan. On a phone this must be the computer's LAN address, not 127.0.0.1.">
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setRuntimeUrl}
          placeholder="http://192.168.1.20:3090"
          placeholderTextColor={colors.placeholder}
          style={styles.input}
          value={runtimeUrl}
        />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setPairingToken}
          placeholder="Pairing token"
          placeholderTextColor={colors.placeholder}
          secureTextEntry
          style={styles.input}
          value={pairingToken}
        />
        <SecondaryButton label="Use pairing link" onPress={onPair} />
        <PrimaryButton busy={busy} disabled={busy} label="Connect" onPress={onConnect} />
      </Section>

      {health ? (
        <Section title="Dependencies" hint="The three-tool pillar plus the local model runtime.">
          {/* GET /api/health nests these under `checks`; the older shape put them
              at the top level, so accept either rather than render "unknown". */}
          <KeyValue label="Context Expert" value={depLabel(dep(health, 'ctx'))} tone={depTone(dep(health, 'ctx'))} />
          <KeyValue label="Graphify" value={depLabel(dep(health, 'graphify'))} tone={depTone(dep(health, 'graphify'))} />
          <KeyValue label="OpenSpec" value={depLabel(dep(health, 'openspec'))} tone={depTone(dep(health, 'openspec'))} />
          <KeyValue label="Ollama" value={depLabel(dep(health, 'ollama'))} tone={depTone(dep(health, 'ollama'))} />
          {health.status ? (
            <KeyValue
              label="Runtime"
              value={health.status}
              tone={health.status === 'ok' ? colors.jedi : colors.imperial}
            />
          ) : null}
        </Section>
      ) : null}

      {readiness ? (
        <Section title="Workspace readiness">
          <Pill
            label={readiness.overall || 'unknown'}
            tone={readiness.trustworthy ? colors.jedi : colors.imperial}
            dim={readiness.trustworthy ? colors.jediDim : colors.imperialDim}
          />
          {(readiness.workspaces || []).slice(0, 6).map((w) => (
            <View key={w.path} style={styles.rowItem}>
              <Text style={styles.itemTitle} numberOfLines={1}>
                {w.path.split('/').filter(Boolean).pop()}
              </Text>
              <Text style={[styles.itemMeta, { color: w.trustworthy ? colors.jedi : colors.imperial }]}>
                {w.state}
              </Text>
            </View>
          ))}
        </Section>
      ) : null}

      <Section
        title="Projects"
        right={<SecondaryButton label="Reload" onPress={onLoadProjects} />}
      >
        {projects.length === 0 ? (
          <EmptyState text="No projects loaded. Connect first." />
        ) : (
          projects.map((project) => {
            const id = project.id || project.path || '';
            const active = selectedProjectId === id;
            return (
              <Pressable
                accessibilityRole="button"
                key={id || project.name}
                onPress={() => setSelectedProjectId(id)}
                style={[styles.listItem, active ? styles.listItemActive : null]}
              >
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {project.name || (project.path || '').split('/').filter(Boolean).pop()}
                </Text>
                <Text style={styles.itemMeta} numberOfLines={1}>{project.path || id}</Text>
              </Pressable>
            );
          })
        )}
      </Section>

      {status ? (
        <Section title="Raw status">
          <Mono>{JSON.stringify(status, null, 2)}</Mono>
        </Section>
      ) : null}
    </>
  );
}

function AskTab({ answer, busy, onAsk, onSearch, projectLabel, query, question, searchResults, setQuery, setQuestion }) {
  const hits = normaliseHits(searchResults);
  return (
    <>
      <Section title="Ask" hint={`Answers blend all three tools, scoped to ${projectLabel}.`}>
        <TextInput
          multiline
          onChangeText={setQuestion}
          placeholder="Ask about an indexed project"
          placeholderTextColor={colors.placeholder}
          style={[styles.input, styles.multiline]}
          value={question}
        />
        <PrimaryButton busy={busy} disabled={busy || !question.trim()} label="Ask YodaMan" onPress={onAsk} />
        {answer ? (
          <View style={styles.resultBox}>
            <Text style={styles.answerText}>{answer}</Text>
          </View>
        ) : null}
      </Section>

      <Section title="Search" hint="Ranked by semantic relevance, graph proximity, centrality, and spec coverage.">
        <TextInput
          onChangeText={setQuery}
          placeholder="Search indexed code"
          placeholderTextColor={colors.placeholder}
          style={styles.input}
          value={query}
        />
        <PrimaryButton busy={busy} disabled={busy || !query.trim()} label="Search workspace" onPress={onSearch} />
        {hits === null ? null : hits.length === 0 ? (
          <EmptyState text="No matches." />
        ) : (
          hits.slice(0, 25).map((hit, i) => (
            <View key={`${hit.file || i}-${i}`} style={styles.rowItem}>
              <Text style={styles.itemTitle} numberOfLines={1}>
                {(hit.file || hit.path || 'result').split('/').filter(Boolean).pop()}
              </Text>
              <Text style={styles.itemMeta} numberOfLines={1}>{hit.file || hit.path}</Text>
              {hit.specFlag?.covered ? (
                <Pill label="spec" tone={colors.imperial} dim={colors.imperialDim} />
              ) : null}
            </View>
          ))
        )}
      </Section>
    </>
  );
}

function StardustTab({ board, busy, diagnose, drift, onLoad, onLoadDiagnostics, readiness }) {
  const changes = board?.changes || [];
  const drifts = drift?.drifts || drift?.items || [];
  return (
    <>
      <Section title="Stardust board" hint="Active OpenSpec changes, read-only from the phone.">
        <PrimaryButton busy={busy} disabled={busy} label="Load board" onPress={onLoad} />
        {board?.graphStatus ? (
          <Pill
            label={`graph ${board.graphStatus}`}
            tone={board.graphStatus === 'current' ? colors.jedi : colors.imperial}
            dim={board.graphStatus === 'current' ? colors.jediDim : colors.imperialDim}
          />
        ) : null}
        {changes.length === 0 ? (
          <EmptyState text="No active changes." />
        ) : (
          changes.slice(0, 20).map((c, i) => (
            <View key={c.name || i} style={styles.rowItem}>
              <Text style={styles.itemTitle} numberOfLines={1}>{c.name || c.id || 'change'}</Text>
              {c.mtimeMs ? (
                <Text style={styles.itemMeta}>{new Date(c.mtimeMs).toLocaleString()}</Text>
              ) : null}
            </View>
          ))
        )}
      </Section>

      <Section title="Drift" hint="Where the workspace has diverged from its specs.">
        {drifts.length === 0 ? (
          <EmptyState text="No drift reported. Load the board first." />
        ) : (
          drifts.slice(0, 20).map((d, i) => (
            <View key={d.file || i} style={styles.rowItem}>
              <Text style={styles.itemTitle} numberOfLines={1}>
                {(d.file || d.path || 'file').split('/').filter(Boolean).pop()}
              </Text>
              <Text style={styles.itemMeta} numberOfLines={1}>{d.reason || d.detail || d.file}</Text>
            </View>
          ))
        )}
      </Section>

      <Section title="Diagnostics">
        <SecondaryButton label="Run diagnostics" onPress={onLoadDiagnostics} />
        {readiness ? <KeyValue label="Readiness" value={readiness.overall || 'unknown'} /> : null}
        {diagnose ? <Mono>{JSON.stringify(diagnose, null, 2).slice(0, 1800)}</Mono> : null}
      </Section>
    </>
  );
}

function ImpactTab({ busy, compose, depth, file, onAnalyze, setDepth, setFile }) {
  return (
    <>
      <Section
        title="Blast radius"
        hint="What every tool knows about one file: the specs describing it, its structural position, and how it ranks."
      >
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setFile}
          placeholder="backend/infrastructure/ToolBox.js"
          placeholderTextColor={colors.placeholder}
          style={styles.input}
          value={file}
        />
        <View style={styles.depthRow}>
          <Readout>Depth</Readout>
          {[1, 2, 3, 4].map((d) => (
            <Pressable
              accessibilityRole="button"
              key={d}
              onPress={() => setDepth(d)}
              style={[styles.depthChip, depth === d ? styles.depthChipActive : null]}
            >
              <Text style={[styles.depthText, depth === d ? styles.depthTextActive : null]}>
                {d} hop{d > 1 ? 's' : ''}
              </Text>
            </Pressable>
          ))}
        </View>
        <PrimaryButton busy={busy} disabled={busy || !file.trim()} label="Analyze" onPress={onAnalyze} />
      </Section>

      {compose ? (
        <Section title="Result">
          <Mono>{JSON.stringify(compose, null, 2).slice(0, 4000)}</Mono>
        </Section>
      ) : null}
    </>
  );
}

function TasksTab({ busy, events, onCancel, onLoad, onOpen, selectedEvent, selectedTaskId, setSelectedEvent, tasks }) {
  return (
    <>
      <Section title="Task timeline">
        <PrimaryButton busy={busy} disabled={busy} label="Load tasks" onPress={onLoad} />
        {tasks.length === 0 ? (
          <EmptyState text="No recent tasks." />
        ) : (
          tasks.map((t) => {
            const tone = statusColor(t.status);
            const active = selectedTaskId === t.taskId;
            return (
              <Pressable
                accessibilityRole="button"
                key={t.taskId}
                onPress={() => onOpen(t.taskId)}
                style={[styles.listItem, active ? styles.listItemActive : null]}
              >
                <View style={styles.rowBetween}>
                  <Pill label={t.status || 'unknown'} tone={tone} />
                  <Text style={styles.itemMetaRight} numberOfLines={1}>{t.taskId}</Text>
                </View>
                <Text style={styles.itemTitle} numberOfLines={2}>{t.task || 'Untitled task'}</Text>
                {['running', 'awaiting_approval', 'cancelling'].includes(t.status) ? (
                  <SecondaryButton label="Cancel" onPress={() => onCancel(t.taskId)} tone={colors.sith} />
                ) : null}
              </Pressable>
            );
          })
        )}
      </Section>

      {events.length > 0 ? (
        <Section title="Events">
          {events.map((event, index) => (
            <Pressable
              accessibilityRole="button"
              key={`${event.timestamp || 'event'}-${index}`}
              onPress={() => setSelectedEvent(event)}
              style={styles.eventRow}
            >
              <Readout style={{ color: colors.holocron }}>{event.type || 'event'}</Readout>
              <Text style={styles.itemMeta} numberOfLines={2}>
                {event.message || event.tool || event.answer || event.timestamp}
              </Text>
            </Pressable>
          ))}
          {selectedEvent ? (
            <View style={styles.resultBox}>
              <Readout>Event detail</Readout>
              <Mono>{JSON.stringify(selectedEvent, null, 2)}</Mono>
            </View>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

function ApprovalsTab({ approvals, busy, onDecide, onLoad }) {
  return (
    <Section
      title="Approval gate"
      hint="Every write the agent proposes stops here. Review the blast radius before deciding."
    >
      <PrimaryButton busy={busy} disabled={busy} label="Refresh pending" onPress={onLoad} />
      {approvals.length === 0 ? (
        <EmptyState text="No pending approvals." />
      ) : (
        approvals.map((item) => {
          const label = item.approval?.params?.filePath || item.taskId;
          const impact = item.approval?.impact;
          return (
            <HudFrame key={item.taskId} tone={colors.imperial}>
              <Text style={styles.itemTitle} numberOfLines={2}>{label}</Text>
              <Text style={styles.itemMeta} numberOfLines={3}>{item.task}</Text>
              {impact ? (
                <>
                  <KeyValue label="Dependents" value={impact.impactedCount ?? '—'} />
                  <KeyValue
                    label="Test coverage"
                    value={impact.covered ? 'covered' : 'no covering test'}
                    tone={impact.covered ? colors.jedi : colors.sith}
                  />
                </>
              ) : null}
              <View style={styles.buttonRow}>
                <View style={styles.flex}>
                  <SecondaryButton
                    label="Reject"
                    onPress={() => onDecide(item.taskId, false, label)}
                    tone={colors.sith}
                  />
                </View>
                <View style={styles.flex}>
                  <PrimaryButton
                    label="Approve"
                    onPress={() => onDecide(item.taskId, true, label)}
                    tone={colors.jedi}
                  />
                </View>
              </View>
            </HudFrame>
          );
        })
      )}
    </Section>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Health checks moved under `checks`; tolerate both shapes. */
function dep(health, name) {
  if (!health) return null;
  return (health.checks && health.checks[name]) || health[name] || null;
}

function depLabel(dep) {
  if (!dep) return 'unknown';
  if (dep.ok === true) return dep.version ? `ok · ${dep.version}` : 'ok';
  if (dep.ok === false) return dep.message || 'unavailable';
  return 'checking';
}

function depTone(dep) {
  if (!dep) return colors.textFaint;
  if (dep.ok === true) return colors.jedi;
  if (dep.ok === false) return colors.sith;
  return colors.imperial;
}

/** The search route has changed shape before; accept the known variants. */
function normaliseHits(searchResults) {
  if (!searchResults) return null;
  if (Array.isArray(searchResults)) return searchResults;
  if (Array.isArray(searchResults.results)) return searchResults.results;
  if (Array.isArray(searchResults.hits)) return searchResults.hits;
  return [];
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.bgPrimary },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 6,
    borderBottomColor: colors.borderFaint,
    borderBottomWidth: 1
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  projectChip: { ...readout, color: colors.holocron },
  tabBar: { borderBottomColor: colors.borderFaint, borderBottomWidth: 1 },
  tabScroll: { paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md },
  tabActive: { backgroundColor: 'rgba(99, 102, 241, 0.16)' },
  tabText: { color: colors.textFaint, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#c7d2fe' },
  container: { padding: 16, paddingBottom: 48, gap: 14 },
  notice: {
    backgroundColor: colors.sithDim,
    borderColor: colors.sith,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 14,
    gap: 6
  },
  noticeText: { color: colors.textPrimary, fontSize: 13, lineHeight: 18 },
  noticeHint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  input: {
    backgroundColor: colors.inputBg,
    borderColor: colors.borderFaint,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 46
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  listItem: {
    backgroundColor: 'rgba(2, 6, 23, 0.4)',
    borderColor: colors.borderFaint,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    gap: 6
  },
  listItemActive: { borderColor: colors.accent, backgroundColor: 'rgba(99, 102, 241, 0.10)' },
  rowItem: {
    borderTopColor: colors.borderFaint,
    borderTopWidth: 1,
    paddingTop: 8,
    gap: 3
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  itemTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  itemMeta: { color: colors.textSecondary, fontSize: 12 },
  itemMetaRight: { color: colors.textFaint, fontSize: 10, fontFamily: fonts.mono, flexShrink: 1 },
  resultBox: {
    backgroundColor: 'rgba(2, 6, 23, 0.5)',
    borderColor: colors.borderFaint,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    gap: 6
  },
  answerText: { color: colors.textPrimary, fontSize: 14, lineHeight: 21 },
  eventRow: {
    borderTopColor: colors.borderFaint,
    borderTopWidth: 1,
    paddingTop: 8,
    gap: 3
  },
  depthRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  depthChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderFaint
  },
  depthChipActive: { backgroundColor: 'rgba(99, 102, 241, 0.16)', borderColor: colors.accent },
  depthText: { color: colors.textFaint, fontSize: 11, fontFamily: fonts.mono, fontWeight: '700' },
  depthTextActive: { color: '#c7d2fe' },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  busyBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 4
  }
});
