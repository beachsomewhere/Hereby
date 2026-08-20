import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import * as backend from "./supabaseBackend";

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
