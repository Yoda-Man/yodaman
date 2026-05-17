import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { createYodaManClient } from './src/api/yodamanClient';

const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:3090';

export default function App() {
  const [runtimeUrl, setRuntimeUrl] = useState(DEFAULT_RUNTIME_URL);
  const [pairingToken, setPairingToken] = useState('');
  const [status, setStatus] = useState(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [busy, setBusy] = useState(false);
  const client = useMemo(() => createYodaManClient(runtimeUrl, pairingToken), [runtimeUrl, pairingToken]);

  async function run(label, action) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      Alert.alert(label, error.message);
    } finally {
      setBusy(false);
    }
  }

  function checkStatus() {
    run('Status failed', async () => {
      const result = await client.status();
      setStatus(result);
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
      const result = await client.ask(question.trim());
      setAnswer(result.answer || JSON.stringify(result, null, 2));
    });
  }

  function searchWorkspace() {
    if (!query.trim()) return;

    run('Search failed', async () => {
      const result = await client.search(query.trim());
      setSearchResults(result);
    });
  }

  function loadApprovals() {
    run('Approvals failed', async () => {
      const result = await client.pendingApprovals();
      setPendingApprovals(Array.isArray(result) ? result : []);
    });
  }

  function decideApproval(taskId, approved) {
    run('Approval failed', async () => {
      await client.approve(taskId, approved);
      const result = await client.pendingApprovals();
      setPendingApprovals(Array.isArray(result) ? result : []);
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>YodaMan</Text>
          <Text style={styles.subtitle}>Mobile companion</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Runtime URL</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setRuntimeUrl}
            placeholder="http://desktop-ip:3090"
            placeholderTextColor="#7A8699"
            style={styles.input}
            value={runtimeUrl}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setPairingToken}
            placeholder="Pairing token"
            placeholderTextColor="#7A8699"
            secureTextEntry
            style={styles.input}
            value={pairingToken}
          />
          <SecondaryButton label="Use Pairing Link" onPress={parsePairingLink} />
          <PrimaryButton disabled={busy} label="Check Status" onPress={checkStatus} />
          {status ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultText}>{JSON.stringify(status, null, 2)}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Ask</Text>
          <TextInput
            multiline
            onChangeText={setQuestion}
            placeholder="Ask about an indexed project"
            placeholderTextColor="#7A8699"
            style={[styles.input, styles.multiline]}
            value={question}
          />
          <PrimaryButton disabled={busy || !question.trim()} label="Ask YodaMan" onPress={askYodaMan} />
          {answer ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultText}>{answer}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Search</Text>
          <TextInput
            onChangeText={setQuery}
            placeholder="Search indexed code"
            placeholderTextColor="#7A8699"
            style={styles.input}
            value={query}
          />
          <PrimaryButton disabled={busy || !query.trim()} label="Search Workspace" onPress={searchWorkspace} />
          {searchResults ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultText}>{JSON.stringify(searchResults, null, 2)}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Approvals</Text>
          <PrimaryButton disabled={busy} label="Refresh Pending Approvals" onPress={loadApprovals} />
          {pendingApprovals.length === 0 ? (
            <Text style={styles.muted}>No pending approvals.</Text>
          ) : (
            pendingApprovals.map((item) => (
              <View key={item.taskId} style={styles.approvalItem}>
                <Text style={styles.approvalTitle}>{item.approval?.params?.filePath || item.taskId}</Text>
                <Text style={styles.muted}>{item.task}</Text>
                <View style={styles.buttonRow}>
                  <SecondaryButton label="Reject" onPress={() => decideApproval(item.taskId, false)} />
                  <PrimaryButton label="Approve" onPress={() => decideApproval(item.taskId, true)} />
                </View>
              </View>
            ))
          )}
        </View>

        {busy ? (
          <View style={styles.busyOverlay}>
            <ActivityIndicator color="#EEF4FF" />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PrimaryButton({ disabled, label, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled ? styles.buttonDisabled : null,
        pressed && !disabled ? styles.buttonPressed : null
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.secondaryButton}>
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#101828'
  },
  container: {
    gap: 18,
    padding: 20,
    paddingBottom: 40
  },
  header: {
    gap: 4,
    paddingTop: 12
  },
  title: {
    color: '#F9FAFB',
    fontSize: 32,
    fontWeight: '700'
  },
  subtitle: {
    color: '#A7B0C0',
    fontSize: 15
  },
  section: {
    gap: 10,
    borderColor: '#263244',
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#151F32',
    padding: 14
  },
  label: {
    color: '#EEF4FF',
    fontSize: 14,
    fontWeight: '700'
  },
  input: {
    minHeight: 44,
    borderColor: '#35445C',
    borderRadius: 6,
    borderWidth: 1,
    color: '#F9FAFB',
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  multiline: {
    minHeight: 88,
    textAlignVertical: 'top'
  },
  button: {
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: '#2E90FA',
    paddingVertical: 12
  },
  buttonPressed: {
    backgroundColor: '#1570EF'
  },
  buttonDisabled: {
    backgroundColor: '#42526B'
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700'
  },
  resultBox: {
    borderRadius: 6,
    backgroundColor: '#0B1220',
    padding: 12
  },
  resultText: {
    color: '#D0D5DD',
    fontFamily: 'Courier',
    fontSize: 12
  },
  muted: {
    color: '#A7B0C0',
    fontSize: 14,
    lineHeight: 20
  },
  approvalItem: {
    gap: 8,
    borderColor: '#35445C',
    borderRadius: 6,
    borderWidth: 1,
    padding: 10
  },
  approvalTitle: {
    color: '#F9FAFB',
    fontSize: 13,
    fontWeight: '700'
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#52637A',
    borderRadius: 6,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12
  },
  secondaryButtonText: {
    color: '#EEF4FF',
    fontSize: 15,
    fontWeight: '700'
  },
  busyOverlay: {
    alignItems: 'center',
    padding: 10
  }
});
