"""Approved warm/original-pitch profile. All filters preserve sample count and pitch."""
import numpy as np
import pyloudnorm as loudness
from scipy.signal import sosfilt, resample_poly

def biquad(kind, frequency, q, gain, sr):
    angle=2*np.pi*frequency/sr; c=np.cos(angle); alpha=np.sin(angle)/(2*q)
    a=10**(gain/40)
    if kind=='peak':
        b=[1+alpha*a,-2*c,1-alpha*a];den=[1+alpha/a,-2*c,1-alpha/a]
    elif kind=='shelf':
        t=2*np.sqrt(a)*alpha
        b=[a*((a+1)+(a-1)*c+t),-2*a*((a-1)+(a+1)*c),a*((a+1)+(a-1)*c-t)]
        den=[(a+1)-(a-1)*c+t,2*((a-1)-(a+1)*c),(a+1)-(a-1)*c-t]
    else:
        b=[(1-c)/2,1-c,(1-c)/2];den=[1+alpha,-2*c,1-alpha]
    return np.array(b+den)/den[0]

def warm_original_pitch(audio, sr, config):
    filters=[biquad('peak',config['presenceHz'],config['presenceQ'],config['presenceGainDb'],sr),
             biquad('shelf',config['shelfHz'],config['shelfQ'],config['shelfGainDb'],sr),
             biquad('lowpass',config['lowpassHz'],1/np.sqrt(2),0,sr)]
    result=sosfilt(np.array(filters),np.asarray(audio,dtype=np.float64))
    if len(result)/sr>=.4 and np.max(np.abs(result))>1e-9:
        measured=loudness.Meter(sr).integrated_loudness(result)
        if np.isfinite(measured):result*=10**((config['loudnessLufs']-measured)/20)
    peak=np.max(np.abs(resample_poly(result,4,1))) if len(result) else 0
    limit=10**(config['truePeakDb']/20)
    if peak>limit:result*=limit/peak
    return result.astype(np.float32)
