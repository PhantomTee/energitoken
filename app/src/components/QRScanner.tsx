import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, Platform } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (data: string) => void;
  title?: string;
};

/** Full-screen camera modal that calls `onScanned` once with the first QR
 * value it reads, then closes itself -- callers decide what to do with the
 * raw string (device code, wallet address, etc). Not available on web; the
 * QR tabs that use this fall back to manual entry there. */
export function QRScanner({ visible, onClose, onScanned, title = "Scan QR code" }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  React.useEffect(() => {
    if (visible) setScanned(false);
  }, [visible]);

  const handleScan = (result: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    onScanned(result.data);
  };

  if (Platform.OS === "web") return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        {!permission ? (
          <View style={styles.center}>
            <Text style={[typography.body, styles.permissionText]}>Checking camera access…</Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={[typography.body, styles.permissionText]}>
              EnergiToken needs camera access to scan QR codes.
            </Text>
            <Pressable style={styles.button} onPress={requestPermission}>
              <Text style={[typography.bodyStrong, styles.buttonText]}>Grant camera access</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={onClose}>
              <Text style={[typography.bodyStrong, styles.secondaryButtonText]}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={scanned ? undefined : handleScan}
            />
            <View style={styles.overlay}>
              <View style={styles.frame} />
              <Text style={[typography.body, styles.hint]}>{title}</Text>
              <Pressable style={styles.closeButton} onPress={onClose}>
                <Text style={[typography.bodyStrong, styles.closeText]}>Cancel</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const FRAME_SIZE = 240;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.black },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  permissionText: { color: colors.neutral.white, textAlign: "center" },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    borderWidth: 3,
    borderColor: colors.terracotta[400],
    borderRadius: radius.md,
    backgroundColor: "transparent",
  },
  hint: { color: colors.neutral.white, backgroundColor: "rgba(0,0,0,0.5)", padding: spacing.sm, borderRadius: radius.md },
  closeButton: {
    position: "absolute",
    bottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.neutral.white,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  closeText: { color: colors.neutral.white },
  button: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  buttonText: { color: colors.neutral.white },
  secondaryButton: { paddingVertical: spacing.sm },
  secondaryButtonText: { color: colors.neutral.white, opacity: 0.7 },
});
