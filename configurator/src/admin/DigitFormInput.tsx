// React is used implicitly for JSX transform
import { useInput, useTranslate, type InputProps } from 'ra-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * ra-core's regex/email/etc. validators serialize their error messages as
 * `@@react-admin@@{"message":"...","args":{...}}` so the i18nProvider can
 * pick them up at render time. When the consumer reads `fieldState.error
 * .message` directly the envelope leaks into the DOM (visible in any
 * Playwright frame as `@@react-admin@@{...}`). Unwrap here so the user-
 * facing copy is the plain string the validator was constructed with.
 */
function unwrapRaError(raw: unknown, translate: (k: string, opts?: Record<string, unknown>) => string): string {
  if (typeof raw !== 'string') return '';
  if (raw.startsWith('@@react-admin@@')) {
    try {
      const parsed = JSON.parse(raw.slice('@@react-admin@@'.length)) as { message?: string; args?: Record<string, unknown> };
      if (parsed?.message) return translate(parsed.message, { _: parsed.message, ...(parsed.args ?? {}) });
    } catch {
      // fall through to raw
    }
  }
  return translate(raw, { _: raw });
}

export interface DigitFormInputProps extends InputProps {
  /** Display label for the input */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** HTML input type (text, email, number, etc.) */
  type?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Additional CSS class names for the wrapper */
  className?: string;
  /** Optional helper text shown below the input (muted) */
  help?: string;
}

export function DigitFormInput({
  label,
  placeholder,
  type = 'text',
  disabled = false,
  className,
  help,
  ...inputProps
}: DigitFormInputProps) {
  // Auto-coerce number inputs so the form value is a number, not a string
  const parseProps = type === 'number' && !inputProps.parse
    ? { ...inputProps, parse: (v: string) => (v === '' ? null : Number(v)) }
    : inputProps;

  const {
    id,
    field,
    fieldState,
    isRequired,
  } = useInput(parseProps);
  const translate = useTranslate();

  const hasError = fieldState.invalid && fieldState.isTouched;
  const errorMessage = unwrapRaError(fieldState.error?.message, translate);

  return (
    <div className={className}>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {isRequired && (
            <span className="text-destructive ml-0.5" aria-label="required">
              *
            </span>
          )}
        </Label>
      )}
      <Input
        id={id}
        type={type}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? `${id}-error` : undefined}
        className={hasError ? 'border-destructive focus-visible:ring-destructive' : ''}
        {...field}
        value={field.value ?? ''}
      />
      {hasError && errorMessage && (
        <p
          id={`${id}-error`}
          className="mt-1 text-xs text-destructive"
          role="alert"
        >
          {errorMessage}
        </p>
      )}
      {!hasError && help && (
        <p className="mt-1 text-xs text-muted-foreground">{help}</p>
      )}
    </div>
  );
}
