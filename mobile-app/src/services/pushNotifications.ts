import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { createNavigationContainerRef } from "@react-navigation/native";
import * as backend from "./supabaseBackend";
import { RootStackParamList } from "../navigation/RootNavigator";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

function navigateToConversationFromNotification(data: unknown): void {
  const payload = data as Record<string, unknown> | undefined;
  const conversationId = payload?.conversationId;
  const threadId = payload?.threadId;
  if (typeof conversationId !== "string") return;
  if (!navigationRef.isReady()) return;
  navigationRef.navigate("Conversation", { conversationId, threadId: typeof threadId === "string" ? threadId : undefined });
}

// Determines whether an incoming notification shows an in-app banner while
// the app is foregrounded. Suppressed for whichever conversation/thread is
// currently on screen (the user's already looking at it - the message
// arrives there via the existing realtime subscription instead), shown
// everywhere else. `activeThreadId` is set by ConversationScreen's own focus
// effect; there's deliberately no global state store involved for this.
let activeThreadId: string | undefined;
export function setActiveThreadId(threadId: string | undefined): void {
  activeThreadId = threadId;
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const notificationThreadId = notification.request.content.data?.threadId;
    const suppress = !!notificationThreadId && notificationThreadId === activeThreadId;
    return {
      shouldShowBanner: !suppress,
      shouldShowList: !suppress,
      shouldPlaySound: !suppress,
      shouldSetBadge: false,
    };
  },
});

// Handles a tap while the JS runtime is already alive (foreground,
// background, or merely suspended - not a cold start).
Notifications.addNotificationResponseReceivedListener((response) => {
  navigateToConversationFromNotification(response.notification.request.content.data);
});

// The app process didn't exist yet when a cold-start tap happened, so the
// listener above never fires for it - call this once after mount instead.
// Retries briefly since RootNavigator registers the Conversation screen only
// after its own async session restore finishes, which can still be pending
// this early.
export async function handleColdStartNotification(): Promise<void> {
  const response = await Notifications.getLastNotificationResponseAsync();
  if (!response) return;
  const data = response.notification.request.content.data;
  for (let attempt = 0; attempt < 10 && !navigationRef.isReady(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  navigateToConversationFromNotification(data);
}

// Simulators/emulators don't support push - Device.isDevice guards that.
// Registration is best-effort: a user who denies permission, or is on a
// simulator, just doesn't get pushes - never blocks onboarding.
export async function registerForPushNotifications(): Promise<void> {
  if (!Device.isDevice) return;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await backend.registerPushToken(token);
}
