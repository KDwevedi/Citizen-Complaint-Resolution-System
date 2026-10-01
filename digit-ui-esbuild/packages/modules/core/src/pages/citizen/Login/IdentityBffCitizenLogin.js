import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader } from "@egovernments/digit-ui-components";
import {
  Button as V2Button,
  Card as V2Card,
} from "@egovernments/digit-ui-components-v2";
import {
  buildIdentityBffAuthorizeUrl,
  establishIdentityBffSession,
  fetchCitizenSigninMethods,
  fillMessage,
  identityBffSurfaceBase,
  restrictIdentityBffDestination,
  sendCitizenOtp,
  verifyCitizenOtp,
} from "@egovernments/digit-ui-libraries";

import { loginSteps } from "./config";
import { setCitizenDetail } from "./index";
import SelectMobileNumber, { V2LoginShell } from "./SelectMobileNumber";
import SelectOtp from "./SelectOtp";
import { useMobileValidationConfig } from "./useMobileValidationConfig";

const cleanAuthResult = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("authResult");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

/**
 * Citizen sign-in on canonical tenant routes. When the BFF offers `phone_otp`
 * (#2189), the phone and code steps run here against the BFF, which sets the
 * citizen session itself. Otherwise sign-in happens inside the
 * `digit-ui-citizen` Keycloak client and signed-out visitors are sent
 * straight there. Either way the resulting BFF session is exchanged for a
 * DIGIT CITIZEN token (issued at the route tenant's root) bound to the route
 * tenant; the card below only renders for failures.
 */
const IdentityBffCitizenLogin = ({ t }) => {
  const location = useLocation();
  const [status, setStatus] = useState("checking");
  const [message, setMessage] = useState("");
  const [methods, setMethods] = useState(null);
  const [mobileNumber, setMobileNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState(null);
  const [resendAfter, setResendAfter] = useState(undefined);
  // Remounts SelectOtp so its timer restarts from `resendAfter`.
  const [otpStep, setOtpStep] = useState(0);
  const [phoneAlert, setPhoneAlert] = useState("");
  const [otpError, setOtpError] = useState("");
  const [busy, setBusy] = useState(false);
  const validationConfig = useMobileValidationConfig();
  const tenant = window.__digitTenantContext;
  const fetchImpl = window.fetch.bind(window);
  const citizenBase = identityBffSurfaceBase(tenant, "citizen");
  const destination = restrictIdentityBffDestination(
    location.state?.from || new URLSearchParams(location.search).get("from"),
    citizenBase,
  );
  const tr = (key, fallback) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  const unavailable = () => tr("CORE_IDENTITY_SIGNIN_UNAVAILABLE", "Sign-in is temporarily unavailable. Please try again.");
  // A BFF OTP failure in the user's language, with its seconds/attempts.
  const failureText = (failure) => {
    const value = t(failure.messageKey, failure.params);
    return value === failure.messageKey ? failure.message : fillMessage(value, failure.params);
  };
  const steps = useMemo(
    () => loginSteps.map((step) => ({
      ...step,
      texts: Object.fromEntries(Object.entries(step.texts).map(([key, text]) => [key, t(text)])),
    })),
    [t],
  );

  const beginSignIn = () => {
    window.location.assign(
      buildIdentityBffAuthorizeUrl({
        surface: "citizen",
        tenant,
        pathname: window.location.pathname,
        destination,
      }),
    );
  };

  // Phone OTP runs in digit-ui; any other method is a Keycloak redirect.
  const startSignIn = async () => {
    const offered = methods || (await fetchCitizenSigninMethods({ fetchImpl }));
    // A failed lookup is not remembered, so "Try again" asks the BFF again.
    if (offered.ok) setMethods(offered);
    if (offered.phoneOtp) {
      setStatus("phone");
    } else if (offered.redirect) {
      beginSignIn();
    } else {
      setStatus("error");
      setMessage(unavailable());
    }
  };

  // The failure card's buttons: a rejected lookup shows the error, not nothing.
  const retry = (step) =>
    step().catch(() => {
      setStatus("error");
      setMessage(unavailable());
    });

  const completeSignIn = (user) => {
    // `user.info.tenantId` is the root the DIGIT citizen account lives at
    // (as with the legacy OTP login); the stored citizen tenant is the route
    // tenant, so complaints and other business requests stay on this URL's
    // tenant.
    Digit.SessionStorage.set("citizen.userRequestObject", user);
    Digit.UserService.setType("citizen");
    Digit.UserService.setUser(user);
    setCitizenDetail(user.info, user.access_token, tenant.tenantId);
    window.location.replace(`${window.location.origin}${destination}`);
  };

  const establishCitizenSession = async () => {
    setStatus("checking");
    setMessage("");

    const authResultId = new URLSearchParams(window.location.search).get("authResult");
    if (authResultId) cleanAuthResult();
    const result = await establishIdentityBffSession({
      surface: "citizen",
      tenant,
      authResultId,
      fetchImpl,
    });

    if (result.status === "signed-out" && !result.fromAuthResult && !result.messageKey) {
      await startSignIn();
      return;
    }
    if (result.status !== "authenticated") {
      setStatus(result.status);
      setMessage(result.messageKey ? tr(result.messageKey, result.message) : "");
      return;
    }

    completeSignIn(result.user);
  };

  const sendCode = () =>
    sendCitizenOtp({
      tenant,
      mobileNumber,
      locale: Digit.StoreData?.getCurrentLanguage?.(),
      fetchImpl,
    });

  const submitMobileNumber = async () => {
    setBusy(true);
    setPhoneAlert("");
    const sent = await sendCode().catch(() => null);
    setBusy(false);
    if (!sent?.ok) {
      setPhoneAlert(sent ? failureText(sent) : unavailable());
      return;
    }
    setChallengeId(sent.challengeId);
    setResendAfter(sent.resendAfter);
    setOtpStep((step) => step + 1);
    setOtp("");
    setOtpError("");
    setStatus("otp");
  };

  // Resolves to the seconds until the next resend, for SelectOtp's timer.
  const resendCode = async () => {
    // One request at a time: a resend replaces the challenge being verified.
    if (busy) return 0;
    setBusy(true);
    const sent = await sendCode().catch(() => null);
    setBusy(false);
    if (sent?.ok) {
      setChallengeId(sent.challengeId);
      setOtp("");
      setOtpError("");
      return sent.resendAfter;
    }
    setOtpError(sent ? failureText(sent) : unavailable());
    return sent?.retryAfter ?? 0;
  };

  const backToPhone = (text) => {
    setChallengeId(null);
    setOtp("");
    setOtpError("");
    setPhoneAlert(text);
    setStatus("phone");
  };

  const submitCode = async () => {
    setBusy(true);
    setOtpError("");
    try {
      const verified = await verifyCitizenOtp({ tenant, challengeId, code: otp, fetchImpl });
      if (!verified.ok) {
        if (verified.code === "OTP_INVALID" && verified.attemptsRemaining !== 0) {
          setOtp("");
          setOtpError(failureText(verified));
        } else if (verified.code === "OTP_EXPIRED") {
          setOtp("");
          setOtpError(failureText(verified));
          setResendAfter(0);
          setOtpStep((step) => step + 1);
        } else {
          // No attempts left, locked, disabled or a failed sign-in: this
          // challenge is spent, so start again from the number.
          backToPhone(failureText(verified));
        }
        return;
      }
      const result = await establishIdentityBffSession({ surface: "citizen", tenant, fetchImpl });
      if (result.status === "authenticated") {
        completeSignIn(result.user);
        return;
      }
      setStatus(result.status === "signed-out" ? "error" : result.status);
      setMessage(result.messageKey
        ? tr(result.messageKey, result.message)
        : tr("CORE_IDENTITY_SIGNIN_FAILED", "Sign-in could not be completed. Please try again."));
    } catch (e) {
      backToPhone(unavailable());
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    establishCitizenSession().catch(() => {
      setStatus("error");
      setMessage(unavailable());
    });
    // Tenant context is immutable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "checking") return <Loader page={true} variant="PageLoader" />;

  if (status === "phone") {
    return (
      <SelectMobileNumber
        t={t}
        config={steps[0]}
        mobileNumber={mobileNumber}
        onMobileChange={(event) => {
          setMobileNumber(event.target.value);
          setPhoneAlert("");
        }}
        onSelect={submitMobileNumber}
        canSubmit={!busy}
        validationConfig={validationConfig}
        alert={phoneAlert}
      />
    );
  }

  if (status === "otp") {
    return (
      <SelectOtp
        key={otpStep}
        t={t}
        config={steps[1]}
        recipient={[validationConfig.prefix, mobileNumber].filter(Boolean).join(" ")}
        otp={otp}
        onOtpChange={(value) => {
          setOtp(value);
          setOtpError("");
        }}
        onSelect={submitCode}
        onResend={resendCode}
        resendAfter={resendAfter}
        error={!otpError}
        errorMessage={otpError}
        onChangeNumber={() => backToPhone("")}
        canSubmit={!busy}
      />
    );
  }

  return (
    <V2LoginShell>
      <V2Card
        style={{
          width: "100%",
          maxWidth: "440px",
          padding: "32px 28px 28px 28px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
              lineHeight: 1.2,
            }}
          >
            {tr("CORE_COMMON_LOGIN", "Sign in")}
          </h1>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-secondary, #6B7280)" }}>
            {tenant.name}
          </p>
        </header>
        {message ? (
          <div role="alert" style={{ color: "var(--color-error, #d4351c)", lineHeight: 1.45 }}>
            {message}
          </div>
        ) : null}
        {status === "forbidden" ? (
          <p style={{ margin: 0, color: "var(--color-text-secondary, #505A5F)" }}>
            {tr("CORE_IDENTITY_SIGN_OUT_HINT", "Sign out if you need to use a different account.")}
          </p>
        ) : null}
        <V2Button
          type="button"
          width="full"
          onClick={
            status === "forbidden"
              ? Digit.UserService.logout
              : status === "error"
                ? () => retry(establishCitizenSession)
                : () => retry(startSignIn)
          }
        >
          {status === "forbidden"
            ? tr("CORE_IDENTITY_SIGN_OUT", "Sign out")
            : status === "error"
              ? tr("CORE_IDENTITY_TRY_AGAIN", "Try again")
              : tr("CORE_IDENTITY_SIGN_IN", "Sign in →")}
        </V2Button>
      </V2Card>
    </V2LoginShell>
  );
};

export default IdentityBffCitizenLogin;
