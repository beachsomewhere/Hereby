import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { RootStackParamList } from "../navigation/RootNavigator";
import { useAppStore, effectiveLocation } from "../state/useAppStore";
import * as backend from "../services/supabaseBackend";
import * as authService from "../services/authService";
import { ConfirmationType, ConversationSummary, Message, ParticipantState, Thread, User } from "../services/types";
import { MessageBubble } from "../components/MessageBubble";
import { ProfileCard } from "../components/ProfileCard";
import { CreateThreadSheet } from "../components/CreateThreadSheet";
import { maskProfanity } from "../services/profanityFilter";
import { setActiveThreadId as setActivePushThreadId } from "../services/pushNotifications";

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
  const { conversationId, threadId: routeThreadId } = route.params;
  const headerHeight = useHeaderHeight();
  const currentUser = useAppStore((s) => s.currentUser);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const logOutInStore = useAppStore((s) => s.logOut);
  const location = useAppStore(effectiveLocation);
  const blockedUserIds = useAppStore((s) => s.blockedUserIds);
  const blockUserInStore = useAppStore((s) => s.blockUser);
  const reportedMessageIds = useAppStore((s) => s.reportedMessageIds);
  const reportMessageInStore = useAppStore((s) => s.reportMessage);

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
  const [threadListVisible, setThreadListVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [muted, setMuted] = useState(false);
  // Slides in from the right edge over the chat rather than a fixed side
  // rail, so a long list of threads never eats into the chat's own width -
  // it's an on-demand overlay, dismissed the same way the app's other
  // sheets are (backdrop tap).
  const threadDrawerWidth = Math.min(300, Dimensions.get("window").width * 0.8);
  const threadDrawerAnim = useRef(new Animated.Value(threadDrawerWidth)).current;
  useEffect(() => {
    Animated.timing(threadDrawerAnim, {
      toValue: threadListVisible ? 0 : threadDrawerWidth,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [threadListVisible, threadDrawerAnim, threadDrawerWidth]);
  // Per-thread "read up to" watermark, client-side only. Seeded to a
  // thread's own lastActivityAt the moment it's first seen in the list, so
  // pre-existing history never lights up a chip - only activity that lands
  // after that point does.
  const [lastSeenAt, setLastSeenAt] = useState<Record<string, string>>({});

  // React Navigation can reuse this exact screen instance across different
  // conversationId params (navigating to "Conversation" while already on a
  // "Conversation" route updates params in place rather than mounting a
  // fresh screen) - without this, activeThreadId/messages/etc from the
  // previous conversation would silently stick around. refresh()'s own
  // `current ?? ...` guard (below) only ever sets activeThreadId when it's
  // still unset, so a stale id from another conversation's thread would
  // never get corrected - and the real backend's RLS then rejects the send
  // outright (wrong conversation_id derived from that stale thread), where
  // the mock had no such check and would have silently posted into the
  // wrong place.
  //
  // Also keyed on routeThreadId (set when arriving via a push notification
  // tap - see pushNotifications.ts) so tapping a second notification for a
  // different thread in a conversation already on screen jumps there too,
  // not just on first mount. Seeding activeThreadId here, before refresh()
  // runs, means refresh()'s own `current ?? ...` default-to-General logic
  // never overrides it.
  useEffect(() => {
    setConversation(undefined);
    setThreads([]);
    setActiveThreadId(routeThreadId);
    setMessages([]);
    setVoteState({});
    setLastSeenAt({});
    setMuted(false);
  }, [conversationId, routeThreadId]);

  // Guards against overlapping poll ticks: without this, a single slow
  // round-trip (checkEligibility especially - a multi-stage edge function)
  // left in flight when the next 6s interval fired caused concurrent
  // requests to stack indefinitely for the rest of the session, confirmed
  // live as the source of request latency that climbed continuously the
  // longer a chat stayed open and only reset on a full reload.
  const refreshInFlightRef = useRef(false);
  // Set the instant the user confirms Leave (handleLeaveConversation below),
  // before the RPC call or navigation.goBack() even happen. Confirmed live:
  // leaving deletes this user's conversation_participants row, which fires
  // recompute_participant_count, which UPDATEs the conversations row, which
  // fires this SAME still-mounted screen's own subscribeToConversation
  // listener (navigation.goBack() doesn't unmount instantly) - without this
  // guard, that triggers one more refresh() -> checkEligibility() that
  // silently re-inserts the user as a participant before the screen finishes
  // closing, undoing the leave entirely.
  const hasLeftRef = useRef(false);
  const refresh = useCallback(async () => {
    if (hasLeftRef.current) return;
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const t0 = Date.now();
      const [conv, threadList] = await Promise.all([
        backend.getConversation(conversationId, location),
        backend.getThreads(conversationId),
      ]);
      console.log(`[timing] getConversation+getThreads: ${Date.now() - t0}ms`);
      setConversation(conv);
      setThreads(threadList);
      navigation.setOptions({ title: conv?.title ?? "" });

      // Default to the General thread once threads have loaded, but never
      // stomp on a thread the user has already switched to.
      setActiveThreadId((current) => current ?? threadList.find((t) => t.isGeneral)?.id ?? threadList[0]?.id);

      if (currentUser && location) {
        try {
          const t1 = Date.now();
          const eligibility = await backend.checkEligibility(currentUser.id, conversationId, location);
          console.log(`[timing] checkEligibility: ${Date.now() - t1}ms`);
          setParticipantState(eligibility.state);
          setMuted(eligibility.muted);
        } catch (err) {
          // This runs on every poll tick (every 6s) and on realtime signals,
          // not just once on mount - an Alert here would fire repeatedly on a
          // sustained failure. Logged instead so it's still visible for
          // debugging without spamming the user.
          console.error("checkEligibility failed:", err instanceof Error ? err.message : err);
        }
      }
    } finally {
      refreshInFlightRef.current = false;
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

  // Separate from refresh()'s own setOptions (title only, re-set every poll
  // tick) - this only needs to run once, not on every 6s refresh.
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => setMenuVisible(true)} hitSlop={10} style={styles.headerMenuButton}>
          <Text style={styles.headerMenuButtonText}>•••</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

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

  const refreshMessagesInFlightRef = useRef(false);
  const refreshMessages = useCallback(async () => {
    if (!activeThreadId) return;
    if (refreshMessagesInFlightRef.current) return;
    refreshMessagesInFlightRef.current = true;
    try {
      const t0 = Date.now();
      const msgs = (await backend.getMessages(activeThreadId)).filter((m) => !m.deletedAt);
      console.log(`[timing] getMessages (${msgs.length} msgs): ${Date.now() - t0}ms`);
      setMessages(msgs);

      // Viewing a thread keeps it caught-up in real time, so its own chip
      // never lights up while it's the one on screen.
      const latest = msgs[msgs.length - 1]?.createdAt;
      if (latest) {
        setLastSeenAt((prev) => (prev[activeThreadId] && prev[activeThreadId] >= latest ? prev : { ...prev, [activeThreadId]: latest }));
      }

      // One batched query instead of one getConfirmations call per message -
      // confirmed live as a major source of thread-switch latency (15+
      // concurrent requests for an active thread's message list).
      const t1 = Date.now();
      const confirmationsByMessage = await backend.getConfirmationsForMessages(msgs.map((m) => m.id));
      console.log(`[timing] getConfirmationsForMessages: ${Date.now() - t1}ms`);
      setVoteState((prev) => {
        const next = { ...prev };
        msgs.forEach((m) => {
          const confirmations = confirmationsByMessage[m.id] ?? [];
          next[m.id] = {
            upvotes: confirmations.filter((c) => c.type === "upvote").length,
            downvotes: confirmations.filter((c) => c.type === "downvote").length,
            myVote: confirmations.find((c) => c.userId === currentUser?.id)?.type,
          };
        });
        return next;
      });
    } finally {
      refreshMessagesInFlightRef.current = false;
    }
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

  // Lets pushNotifications' foreground handler suppress the in-app banner
  // for whatever thread is actually on screen right now - cleared on
  // unmount so navigating away doesn't keep suppressing this thread's
  // notifications from elsewhere in the app.
  useEffect(() => {
    setActivePushThreadId(activeThreadId);
    return () => setActivePushThreadId(undefined);
  }, [activeThreadId]);

  async function handleSend() {
    if (!currentUser || !activeThreadId || !draft.trim() || participantState === "read_only" || participantState === "left") return;
    try {
      // Appended locally the instant the insert succeeds, rather than
      // waiting on the realtime subscription or the 6s poll to refetch and
      // bring it back - confirmed live: without this, a sent message could
      // sit invisible for several seconds until one of those fired.
      // refreshMessages' own setMessages call fully replaces this array
      // once a real refetch happens, so there's no duplicate-entry risk.
      const sent = await backend.sendMessage(activeThreadId, currentUser, draft.trim(), replyTo?.id);
      // Follows the exact same rule as any other new message
      // (onContentSizeChange only auto-scrolls when already near the
      // bottom) - sending while scrolled up to read history shouldn't yank
      // you away from what you were reading either; the jump-to-latest
      // button is the only way back down in that case, same as it would be
      // for someone else's message arriving.
      setMessages((prev) => [...prev, sent]);
      setDraft("");
      setReplyTo(undefined);
    } catch (err) {
      Alert.alert("Couldn't send message", err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  async function handleVote(message: Message, type: ConfirmationType) {
    if (!currentUser) return;
    try {
      const { upvotes, downvotes, myVote } = await backend.voteMessage(message.id, currentUser.id, type);
      setVoteState((prev) => ({ ...prev, [message.id]: { upvotes, downvotes, myVote } }));
    } catch (err) {
      Alert.alert("Couldn't vote", err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  function handleReport(message: Message) {
    if (!currentUser) return;
    Alert.alert("Report message", "Report this message to moderators?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Report",
        style: "destructive",
        onPress: () => {
          backend.reportTarget(currentUser.id, "message", message.id, "reported from chat");
          reportMessageInStore(message.id);
        },
      },
    ]);
  }

  async function handleToggleMute() {
    const next = !muted;
    try {
      await backend.setConversationMuted(conversationId, next);
      setMuted(next);
    } catch (err) {
      Alert.alert("Couldn't update mute", err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  function handleLeaveConversation() {
    if (!currentUser) return;
    Alert.alert("Leave conversation", "You'll stop seeing new activity here unless you rejoin.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          hasLeftRef.current = true;
          try {
            await backend.leaveConversation(currentUser.id, conversationId);
            setMenuVisible(false);
            navigation.goBack();
          } catch (err) {
            hasLeftRef.current = false; // the leave itself failed - resume normal polling
            Alert.alert("Couldn't leave", err instanceof Error ? err.message : "Something went wrong. Try again.");
          }
        },
      },
    ]);
  }

  async function openProfile(userId: string, username: string) {
    try {
      const user = await backend.getUser(userId);
      // A genuinely-missing user falls back to a placeholder (0 points,
      // level 1) - that's a real "this account doesn't exist" case, not the
      // same as a failed fetch, which throws instead of reaching here.
      setProfileUser(user ?? { id: userId, username, avatarSeed: userId, level: 1, helpfulPoints: 0, createdAt: new Date().toISOString(), badgeIds: [] });
    } catch (err) {
      Alert.alert("Couldn't load profile", err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  async function handleSelectIcon(icon: string) {
    if (!currentUser) return;
    try {
      const updated = await backend.updateAvatarIcon(currentUser.id, icon);
      if (!updated) return;
      setCurrentUser(updated);
      setProfileUser(updated);
    } catch (err) {
      Alert.alert("Couldn't update icon", err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  async function handleLogOut() {
    // No explicit navigation call needed - RootNavigator conditionally
    // renders Onboarding vs. the Map/Conversation/DevPanel stack based on
    // currentUser, so clearing it here (via logOutInStore) swaps the whole
    // navigator over on its own. Navigating manually would fail anyway:
    // "Onboarding" isn't a registered screen in *this* stack instance while
    // currentUser is still set.
    setProfileUser(undefined);
    await authService.signOut();
    logOutInStore();
  }

  const banner = STATE_BANNER[participantState];
  const canPost = participantState === "inside" || participantState === "grace";

  function hasUnread(thread: Thread) {
    if (thread.id === activeThreadId) return false;
    const seen = lastSeenAt[thread.id];
    return !!seen && thread.lastActivityAt > seen;
  }

  const unreadThreads = useMemo(() => threads.filter(hasUnread), [threads, activeThreadId, lastSeenAt]);

  // Pulses continuously while any other thread has unread activity, rather
  // than a static dot easy to miss - starts/stops the loop only when
  // unreadThreads flips between empty and non-empty, not on every render.
  const unreadBlinkAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (unreadThreads.length === 0) {
      unreadBlinkAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(unreadBlinkAnim, { toValue: 0.25, duration: 500, useNativeDriver: true }),
        Animated.timing(unreadBlinkAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [unreadThreads.length > 0]);

  function jumpToActiveThread() {
    // Most-recently-active among the unread ones, not just the first in
    // list order - if several threads have unread activity, this is the
    // one most likely to be what the user actually wants to see.
    const target = [...unreadThreads].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0];
    if (target) setActiveThreadId(target.id);
  }

  const messagesById = useMemo(() => {
    const map: Record<string, Message> = {};
    messages.forEach((m) => (map[m.id] = m));
    return map;
  }, [messages]);

  const visibleMessages = useMemo(
    () => messages.filter((m) => !currentUser || !blockedUserIds.has(m.userId) || m.userId === currentUser.id),
    [messages, currentUser, blockedUserIds]
  );

  // onContentSizeChange (below, on the FlatList itself) handles scrolling to
  // the latest message as new ones arrive - it fires after the new content
  // has actually been measured/laid out, unlike a useEffect keyed on
  // message count, which can fire before layout completes and scroll short
  // of the true end. Switching threads needs its own explicit trigger
  // though (confirmed live: landed mid-list, not at the bottom) - the
  // previous thread's scroll offset doesn't necessarily reset before the
  // new thread's (often shorter) content renders, so onContentSizeChange
  // alone can land wherever that stale offset happened to clamp to.
  const messageListRef = useRef<FlatList>(null);
  // Tracked as a ref (not state) so onContentSizeChange - which fires from
  // a FlatList callback, not a render - always reads the latest value
  // instead of one captured in a stale closure. Starts true so the first
  // load still lands at the bottom.
  const isNearBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const NEAR_BOTTOM_THRESHOLD = 120;

  function handleMessagesScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const nearBottom = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
    isNearBottomRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }

  function jumpToLatest() {
    messageListRef.current?.scrollToEnd({ animated: true });
    isNearBottomRef.current = true;
    setShowJumpToLatest(false);
  }

  useEffect(() => {
    if (activeThreadId) {
      messageListRef.current?.scrollToEnd({ animated: false });
      isNearBottomRef.current = true;
      setShowJumpToLatest(false);
    }
  }, [activeThreadId]);

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

      <Pressable style={styles.threadToggle} onPress={() => setThreadListVisible(true)}>
        <Text style={styles.threadToggleText} numberOfLines={1}>
          {threads.find((t) => t.id === activeThreadId)?.title ?? "Threads"}
        </Text>
        <View style={styles.threadToggleRight}>
          {unreadThreads.length > 0 && (
            // Grouped with the "N threads" label rather than the current
            // thread's own name - this indicates activity in OTHER threads,
            // so it needs to read as attached to the entry point for
            // switching threads, not to the thread already on screen.
            // Separate tap target from the rest of the bar - tapping the
            // pulsing indicator itself jumps straight to the thread with
            // activity, while tapping elsewhere on the bar still opens the
            // full thread list.
            <Pressable onPress={jumpToActiveThread} hitSlop={8} style={styles.threadToggleUnreadTarget}>
              <Animated.View style={[styles.threadToggleDot, { opacity: unreadBlinkAnim }]} />
            </Pressable>
          )}
          <Text style={styles.threadToggleCount}>
            {threads.length} thread{threads.length === 1 ? "" : "s"} ▸
          </Text>
        </View>
      </Pressable>

      <View style={styles.messagesWrap}>
      <FlatList
        ref={messageListRef}
        data={visibleMessages}
        onContentSizeChange={() => {
          // Only auto-follow new content if already near the bottom -
          // otherwise a message arriving while reading back through
          // history would yank the view down out from under you. Sending
          // your own message (handleSend) and switching threads (above)
          // both scroll unconditionally on their own, so this only governs
          // the "someone else's new message arrived" case.
          if (isNearBottomRef.current) {
            messageListRef.current?.scrollToEnd({ animated: false });
          }
        }}
        onScroll={handleMessagesScroll}
        scrollEventThrottle={100}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            isOwn={item.userId === currentUser?.id}
            isReported={reportedMessageIds.has(item.id)}
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

      {showJumpToLatest && (
        <Pressable style={styles.jumpToLatest} onPress={jumpToLatest}>
          <Text style={styles.jumpToLatestText}>↓ Jump to latest</Text>
        </Pressable>
      )}
      </View>

      {replyTo && (
        <View style={styles.replyBar}>
          <Text style={styles.replyText} numberOfLines={1}>
            Replying to {replyTo.username}: {maskProfanity(replyTo.body)}
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
        onSelectIcon={handleSelectIcon}
        onLogOut={handleLogOut}
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

      <Modal visible={menuVisible} transparent animationType="slide" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuVisible(false)} />
        <View style={styles.menuSheet}>
          <View style={styles.handle} />
          <Pressable style={styles.menuRow} onPress={handleToggleMute}>
            <Text style={styles.menuRowText}>{muted ? "Unmute notifications" : "Mute notifications"}</Text>
          </Pressable>
          <Pressable
            style={styles.menuRowDanger}
            onPress={() => {
              setMenuVisible(false);
              handleLeaveConversation();
            }}
          >
            <Text style={styles.menuRowDangerText}>Leave conversation</Text>
          </Pressable>
        </View>
      </Modal>

      <Modal visible={threadListVisible} transparent animationType="fade" onRequestClose={() => setThreadListVisible(false)}>
        <Pressable style={styles.threadDrawerBackdrop} onPress={() => setThreadListVisible(false)} />
        <Animated.View
          style={[styles.threadDrawer, { width: threadDrawerWidth, transform: [{ translateX: threadDrawerAnim }] }]}
        >
          <Text style={styles.threadDrawerTitle}>Threads</Text>
          <FlatList
            data={threads}
            keyExtractor={(t) => t.id}
            contentContainerStyle={styles.threadDrawerList}
            renderItem={({ item: t }) => {
              const unread = hasUnread(t);
              const active = activeThreadId === t.id;
              return (
                <Pressable
                  style={[styles.threadDrawerRow, active && styles.threadDrawerRowActive]}
                  onPress={() => {
                    setActiveThreadId(t.id);
                    setThreadListVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.threadDrawerRowText,
                      unread && styles.threadDrawerRowTextUnread,
                      active && styles.threadDrawerRowTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {t.title}
                  </Text>
                  {unread && <View style={styles.threadDrawerDot} />}
                </Pressable>
              );
            }}
          />
          {canPost && (
            <Pressable
              style={styles.threadDrawerAdd}
              onPress={() => {
                setThreadListVisible(false);
                setCreateThreadVisible(true);
              }}
            >
              <Text style={styles.threadDrawerAddText}>+ New thread</Text>
            </Pressable>
          )}
        </Animated.View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "white" },
  banner: { backgroundColor: "#FAEEDA", padding: 10 },
  bannerText: { fontSize: 12, color: "#412402", textAlign: "center" },
  headerMenuButton: { paddingHorizontal: 8, paddingVertical: 4 },
  headerMenuButtonText: { fontSize: 18, color: "#2C2C2A", fontWeight: "600" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  menuSheet: {
    backgroundColor: "white",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D3D1C7", alignSelf: "center", marginBottom: 16 },
  menuRow: { paddingVertical: 14 },
  menuRowText: { fontSize: 15, color: "#2C2C2A" },
  menuRowDanger: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: "#EDEBE3" },
  menuRowDangerText: { fontSize: 15, color: "#A32D2D" },
  threadToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#EDEBE3",
  },
  threadToggleText: { fontSize: 14, fontWeight: "600", color: "#2C2C2A", flexShrink: 1 },
  threadToggleRight: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto" },
  threadToggleUnreadTarget: { padding: 4 },
  threadToggleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF9F27" },
  threadToggleCount: { fontSize: 12, color: "#888780" },
  threadDrawerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  threadDrawer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "white",
    paddingTop: 60,
    paddingHorizontal: 16,
    borderLeftWidth: 1,
    borderLeftColor: "#EDEBE3",
  },
  threadDrawerTitle: { fontSize: 16, fontWeight: "600", marginBottom: 12 },
  threadDrawerList: { paddingBottom: 12 },
  threadDrawerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  threadDrawerRowActive: { backgroundColor: "#2C2C2A" },
  threadDrawerRowText: { fontSize: 14, color: "#2C2C2A", fontWeight: "500", flexShrink: 1 },
  threadDrawerRowTextUnread: { color: "#B5570B", fontWeight: "600" },
  threadDrawerRowTextActive: { color: "white" },
  threadDrawerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF9F27", marginLeft: 8 },
  threadDrawerAdd: {
    borderTopWidth: 1,
    borderTopColor: "#EDEBE3",
    paddingVertical: 14,
    alignItems: "center",
  },
  threadDrawerAddText: { fontSize: 14, color: "#5F5E5A", fontWeight: "500" },
  list: { paddingVertical: 12 },
  messagesWrap: { flex: 1 },
  jumpToLatest: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    backgroundColor: "#2C2C2A",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  jumpToLatestText: { color: "white", fontSize: 13, fontWeight: "500" },
  replyBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F1EFE8", paddingHorizontal: 14, paddingVertical: 8 },
  replyText: { fontSize: 12, color: "#444441", flex: 1 },
  replyCancel: { fontSize: 12, color: "#5F5E5A", marginLeft: 12 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", padding: 12, borderTopWidth: 1, borderTopColor: "#EDEBE3", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 100 },
  sendButton: { backgroundColor: "#2C2C2A", borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 },
  sendButtonText: { color: "white", fontSize: 13, fontWeight: "500" },
});
