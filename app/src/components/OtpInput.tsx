import React, { useRef } from "react";
import { View, TextInput, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";

const LENGTH = 6;

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  editable?: boolean;
  autoFocus?: boolean;
};

/** Six individual boxes instead of one text field -- each digit auto-advances
 * focus to the next box, backspace on an empty box moves back to the
 * previous one. `value`/`onChangeText` still behave like a single string
 * field from the parent's point of view, so this drops in without changing
 * how the OTP flow is wired up. */
export function OtpInput({ value, onChangeText, editable = true, autoFocus }: Props) {
  const inputs = useRef<Array<TextInput | null>>([]);

  const setDigit = (index: number, digit: string) => {
    // Truncate-and-append rather than a positional splice: splicing a hole
    // into the middle of the string (chars[index] = digit; chars.join(""))
    // collapses gaps, so clearing/editing a middle box silently shifted
    // every later digit left by one instead of leaving that box blank.
    const next = (value.slice(0, index) + digit).slice(0, LENGTH);
    onChangeText(next);

    if (digit && index < LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !value[index] && index > 0) {
      inputs.current[index - 1]?.focus();
      onChangeText(value.slice(0, index - 1));
    }
  };

  return (
    <View style={styles.row}>
      {Array.from({ length: LENGTH }).map((_, i) => (
        <TextInput
          key={i}
          ref={(ref) => {
            inputs.current[i] = ref;
          }}
          style={styles.box}
          value={value[i] ?? ""}
          onChangeText={(t) => setDigit(i, t.replace(/[^0-9]/g, "").slice(-1))}
          onKeyPress={({ nativeEvent }) => handleKeyPress(i, nativeEvent.key)}
          keyboardType="number-pad"
          maxLength={1}
          editable={editable}
          autoFocus={autoFocus && i === 0}
          textAlign="center"
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.md },
  box: {
    width: 44,
    height: 52,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    borderRadius: radius.md,
    fontSize: 22,
    fontFamily: typography.dataMd.fontFamily,
  },
});
