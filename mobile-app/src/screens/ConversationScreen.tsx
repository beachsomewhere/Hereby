import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { RootStackParamList } from "../navigation/RootNavigator";
import { useAppStore, effectiveLocation } from "../state/useAppStore";
import * as backend from "../services/mockBackend";
import { ConfirmationType, ConversationSummary, Message, ParticipantState, Thread, User } from "../services/types";
import { MessageBubble } from "../components/MessageBubble";
import { ProfileCard } from "../components/ProfileCard";
import { CreateThreadSheet } from "../components/CreateThreadSheet";

type Props = NativeStackScreenProps<RootStackParamList, "Conversation">;

// useHeaderHeight() alone still leaves the input row a few points under the
// keyboard on iOS - this closes that gap.
const KEYBOARD_OFFSET_PADDING = 10;

const STATE_BANNER: Record<ParticipantState, string | undefined> = {
  inside: undefined,
  grace: "You've stepped outside the area - you can still post for a little while.",
  read_only: "You've left this area - read-only now.",
  left: "You're not currently eligible to post here.",
};

export function ConversationScreen({ route, navigation }: Props) {
  const { conversationId } = route.params;
  const headerHeight = useHeaderHeight();
  const currentUser = useAppStore((s) => s.currentUser);
  const location = useAppStore(effectiveLocation);
  const blockedUserIds = useAppStore((s) => s.blockedUserIds);
  const blockUserInStore = useAppStore((s) => s.blockUser);

  const [conversation, setConversation] = useState<ConversationSummary>();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [participantState, setParticipantState] = useState<ParticipantState>("inside");
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Message>();
  const [profileUser, setProfileUser] = useState<User>();
  const [voteState, setVoteState] = useState<Record<string, { upvotes: number; downvotes: number; myVote?: ConfirmationType }>>({});
  const [createThreadVisible, setCreateThreadVisible] = useState(false);
  // Per-thread "read up to" watermark, client-side only. Seeded to a
  // thread's own lastActivityAt the moment it's first seen in the list, so
  // pre-existing history never lights up a chip - only activity that lands
  // after that point does.
  const [lastSeenAt, setLastSeenAt] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const [conv, threadList] = await Promise.all([
      backend.getConversation(conversationId, location),
      backend.getThreads(conversationId),
    ]);
    setConversation(conv);
    setThreads(threadList);
    navigation.setOptions({ title: conv?.title ?? "" });

    // Default to the General thread once threads have loaded, but never
    // stomp on a thread the user has already switched to.
    setActiveThreadId((current) => current ?? threadList.find((t) => t.isGeneral)?.id ?? threadList[0]?.id);

    if (currentUser && location) {
      const eligibility = await backend.checkEligibility(currentUser.id, conversationId, location);
      setParticipantState(eligibility.state);
    }
  }, [conversationId, location, currentUser, navigation]);

  useEffect(() => {
    refresh();
    const unsubscribe = backend.subscribeToConversation(conversationId, refresh);
    const interval = setInterval(refresh, 6000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh, conversationId]);

  useEffect(() => {
    setLastSeenAt((prev) => {
      const next = { ...prev };
      let changed = false;
      threads.forEach((t) => {
        if (!(t.id in next)) {
          next[t.id] = t.lastActivityAt;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [threads]);

  const refreshMessages = useCallback(async () => {
    if (!activeThreadId) return;
    const msgs = (await backend.getMessages(activeThreadId)).filter((m) => !m.deletedAt);
    setMessages(msgs);

    // Viewing a thread keeps it caught-up in real time, so its own chip
    // never lights up while it's the one on screen.
    const latest = msgs[msgs.length - 1]?.createdAt;
    if (latest) {
      setLastSeenAt((prev) => (prev[activeThreadId] && prev[activeThreadId] >= latest ? prev : { ...prev, [activeThreadId]: latest }));
    }

    const votes = await Promise.all(msgs.map((m) => backend.getConfirmations(m.id)));
    setVoteState((prev) => {
      const next = { ...prev };
      msgs.forEach((m, i) => {
        const confirmations = votes[i];
        next[m.id] = {
          upvotes: confirmations.filter((c) => c.type === "upvote").length,
          downvotes: confirmations.filter((c) => c.type === "downvote").length,
          myVote: confirmations.find((c) => c.userId === currentUser?.id)?.type,
        };
      });
      return next;
    });
  }, [activeThreadId, currentUser]);

  useEffect(() => {
    if (!activeThreadId) return;
    refreshMessages();
    const unsubscribe = backend.subscribeToThread(activeThreadId, refreshMessages);
    const interval = setInterval(refreshMessages, 6000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refreshMessages, activeThreadId]);

  async function handleSend() {
    if (!currentUser || !activeThreadId || !draft.trim() || participantState === "read_only" || participantState === "left") return;
    await backend.sendMessage(activeThreadId, currentUser, draft.trim(), replyTo?.id);
    setDraft("");
    setReplyTo(undefined);
  }

  async function handleVote(message: Message, type: ConfirmationType) {
    if (!currentUser) return;
    const { upvotes, downvotes, myVote } = await backend.voteMessage(message.id, currentUser.id, type);
    setVoteState((prev) => ({ ...prev, [message.id]: { upvotes, downvotes, myVote } }));
  }

  function handleReport(message: Message) {
    if (!currentUser) return;
    Alert.alert("Report message", "Report this message to moderators?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Report",
        style: "destructive",
        onPress: () => backend.reportTarget(currentUser.id, "message", message.id, "reported from chat"),
      },
    ]);
  }

  async function openProfile(userId: string, username: string) {
    const user = await backend.getUser(userId);
    setProfileUser(user ?? { id: userId, username, avatarSeed: userId, level: 1, helpfulPoints: 0, createdAt: new Date().toISOString(), badgeIds: [] });
  }

  const banner = STATE_BANNER[participantState];
  const canPost = participantState === "inside" || participantState === "grace";

  function hasUnread(thread: Thread) {
    if (thread.id === activeThreadId) return false;
    const seen = lastSeenAt[thread.id];
    return !!seen && thread.lastActivityAt > seen;
  }

  const messagesById = useMemo(() => {
    const map: Record<string, Message> = {};
    messages.forEach((m) => (map[m.id] = m));
    return map;
  }, [messages]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight + KEYBOARD_OFFSET_PADDING : 0}
    >
      {banner && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.threadRow}
        contentContainerStyle={styles.threadRowContent}
      >
        {threads.map((t) => {
          const unread = hasUnread(t);
          return (
            <Pressable
              key={t.id}
              onPress={() => setActiveThreadId(t.id)}
              style={[
                styles.threadChip,
                unread && styles.threadChipUnread,
                activeThreadId === t.id && styles.threadChipActive,
              ]}
            >
              <Text
                style={[
                  styles.threadChipText,
                  unread && styles.threadChipTextUnread,
                  activeThreadId === t.id && styles.threadChipTextActive,
                ]}
              >
                {t.title}
              </Text>
            </Pressable>
          );
        })}
        {canPost && (
          <Pressable onPress={() => setCreateThreadVisible(true)} style={styles.threadChipAdd}>
            <Text style={styles.threadChipAddText}>+ New thread</Text>
          </Pressable>
        )}
      </ScrollView>

      <FlatList
        data={messages.filter((m) => !currentUser || !blockedUserIds.has(m.userId) || m.userId === currentUser.id)}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            isOwn={item.userId === currentUser?.id}
            replyToMessage={item.replyToId ? messagesById[item.replyToId] : undefined}
            upvotes={voteState[item.id]?.upvotes}
            downvotes={voteState[item.id]?.downvotes}
            myVote={voteState[item.id]?.myVote}
            onVote={(type) => handleVote(item, type)}
            onReport={() => handleReport(item)}
            onReply={() => setReplyTo(item)}
            onOpenProfile={() => openProfile(item.userId, item.username)}
          />
        )}
        contentContainerStyle={styles.list}
      />

      {replyTo && (
        <View style={styles.replyBar}>
          <Text style={styles.replyText} numberOfLines={1}>
            Replying to {replyTo.username}: {replyTo.body}
          </Text>
          <Pressable onPress={() => setReplyTo(undefined)}>
            <Text style={styles.replyCancel}>Cancel</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={participantState === "read_only" ? "Read-only from here" : "Message"}
          editable={participantState !== "read_only" && participantState !== "left"}
          multiline
        />
        <Pressable style={styles.sendButton} onPress={handleSend} disabled={!draft.trim()}>
          <Text style={styles.sendButtonText}>Send</Text>
        </Pressable>
      </View>

      <ProfileCard
        user={profileUser}
        visible={!!profileUser}
        isSelf={!!profileUser && profileUser.id === currentUser?.id}
        onClose={() => setProfileUser(undefined)}
        onBlock={() => {
          if (profileUser) blockUserInStore(profileUser.id);
          setProfileUser(undefined);
        }}
        onReport={() => {
          if (currentUser && profileUser) backend.reportTarget(currentUser.id, "user", profileUser.id, "reported from profile card");
          setProfileUser(undefined);
        }}
      />

      <CreateThreadSheet
        visible={createThreadVisible}
        conversationId={conversationId}
        userId={currentUser?.id}
        onClose={() => setCreateThreadVisible(false)}
        onCreated={(thread) => {
          // Don't append here - creating a thread already fires
          // notifyConversation, which drives this screen's own
          // subscribeToConversation-based refresh() to re-fetch the
          // authoritative thread list. Appending on top of that raced and
          // sometimes produced the same thread twice.
          setCreateThreadVisible(false);
          setActiveThreadId(thread.id);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "white" },
  banner: { backgroundColor: "#FAEEDA", padding: 10 },
  bannerText: { fontSize: 12, color: "#412402", textAlign: "center" },
  threadRow: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: "#EDEBE3" },
  threadRowContent: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  threadChip: { borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  threadChipUnread: { backgroundColor: "#FAEEDA", borderColor: "#EF9F27" },
  threadChipActive: { backgroundColor: "#2C2C2A", borderColor: "#2C2C2A" },
  threadChipText: { fontSize: 12, color: "#444441", fontWeight: "500" },
  threadChipTextUnread: { color: "#412402", fontWeight: "600" },
  threadChipTextActive: { color: "white" },
  threadChipAdd: { borderWidth: 1, borderColor: "#D3D1C7", borderStyle: "dashed", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  threadChipAddText: { fontSize: 12, color: "#5F5E5A" },
  list: { paddingVertical: 12 },
  replyBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F1EFE8", paddingHorizontal: 14, paddingVertical: 8 },
  replyText: { fontSize: 12, color: "#444441", flex: 1 },
  replyCancel: { fontSize: 12, color: "#5F5E5A", marginLeft: 12 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", padding: 12, borderTopWidth: 1, borderTopColor: "#EDEBE3", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 100 },
  sendButton: { backgroundColor: "#2C2C2A", borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 },
  sendButtonText: { color: "white", fontSize: 13, fontWeight: "500" },
});
