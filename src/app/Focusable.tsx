/**
 * A button that can actually be reached with a remote.
 *
 * This exists because of two things the spike cost days to learn:
 *
 *   Nothing is focused by default on Vega. Without seeding focus the D-pad
 *   has no target and every press goes nowhere, which looks exactly like a
 *   dead app rather than a navigation problem.
 *
 *   `FocusManager` wants a native tag, not a component ref, so focus has to
 *   go through `findNodeHandle`. The `Navigable` component the docs describe
 *   does not exist in react-native-kepler 4.0 — that is the 0.72-era API.
 *
 * Focus is also drawn as a border, not a tint: at ten feet a colour shift is
 * invisible, and this app's users are the last people who should have to
 * squint to find the cursor.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  Text,
  View,
  findNodeHandle,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { FocusManager } from '@amazon-devices/react-native-kepler';

import { colour, radius, space, type } from './theme';

export interface FocusableProps {
  label: string;
  onPress: () => void;
  /** Seed focus here on mount. Exactly one per screen. */
  autoFocus?: boolean;
  /** Drawn as chosen, independently of focus. */
  selected?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  /** Smaller treatment for dense rows such as the settings list. */
  compact?: boolean;
}

export function Focusable({
  label,
  onPress,
  autoFocus = false,
  selected = false,
  disabled = false,
  style,
  compact = false,
}: FocusableProps): React.JSX.Element {
  const ref = useRef<View | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!autoFocus) return undefined;
    // A frame's grace: the native view has to exist before it can hold focus.
    const t = setTimeout(() => {
      const tag = ref.current ? findNodeHandle(ref.current) : null;
      if (tag != null) FocusManager.focus(tag);
    }, 300);
    return () => clearTimeout(t);
  }, [autoFocus]);

  const handle = useCallback(() => {
    if (!disabled) onPress();
  }, [disabled, onPress]);

  return (
    <Pressable
      ref={ref}
      focusable={!disabled}
      disabled={disabled}
      onPress={handle}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.base,
        compact && styles.compact,
        selected && styles.selected,
        focused && styles.focused,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.label, compact && styles.labelCompact, focused && styles.labelFocused]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: colour.surface,
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: radius.sm,
  },
  compact: {
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
  },
  // Chosen but not focused: a quiet left marker, so selection survives when
  // the cursor moves elsewhere.
  selected: {
    backgroundColor: colour.accentSoft,
    borderLeftColor: colour.accent,
  },
  focused: {
    borderColor: colour.accent,
    backgroundColor: colour.accentSoft,
  },
  disabled: { opacity: 0.35 },
  label: { color: colour.ink, fontSize: type.body },
  labelCompact: { fontSize: type.label },
  labelFocused: { color: colour.ink },
});
