async function refreshMyBookings(){
    if(!currentUser?.id){
        bookedCount = 0;
        bookedSlotKey = null;
        bookedSlotObj = null;
        renderBookedCount(false);
        return [];
    }
    try{
        const res = await fetch(`/api/bookings?userId=${encodeURIComponent(currentUser.id)}`);
        if(!res.ok) throw new Error('Failed to load bookings');
        const data = await res.json();
        const rows = Array.isArray(data.bookings) ? data.bookings : [];
        bookedCount = rows.length;
        // store in-memory only; bookings persisted in Supabase
        const latest = rows[0];
        if(latest){
            // Use slotKey directly from backend to ensure consistency
            bookedSlotKey = latest.slotKey || null;
            bookedSlotObj = {
                courseId: latest.courseId || latest.course_id,
                day: latest.day,
                time: latest.time,
                date: latest.date || '',
                bookingId: latest.id
            };
        }else{
            setBookedSlot(null);
        }
        renderBookedCount(false);
        return rows;
    }catch(e){
        return [];
    }
}
function doBook(){
  if(!sel) return;
  const course = COURSES.find(c=>c.id===sel?.courseId);
  const slot = SLOTS.find(s=>s.courseId===sel.courseId&&s.day===sel.day&&s.time===sel.time);
  if(!slot) return;
  if(slot.full || isBookedSlot(slot)){
    renderBookedCount(false);
    updateBar();
    return;
  }
  document.getElementById('sucTitle').textContent=course ? course.name : '—';
  document.getElementById('succOv').classList.add('show');
  const slotKeyToSend = getSlotKey(slot);
  const bookingPayload = {
    userId: currentUser?.id || '',
    userName: currentUser?.username || currentUser?.global_name || 'Discord user',
    courseId: course.id,
    courseName: course.name,
    day: slot.day,
    time: slot.time,
    date: slot.date || '',
    slotKey: slotKeyToSend
  };
  fetch('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bookingPayload)
  })
    .then(async res=>{
      const data = await res.json().catch(()=>null);
      if(!res.ok){
        throw new Error((data && data.error) || 'Không thể giữ slot');
      }
      const booking = data && data.booking ? data.booking : null;
      if (booking) {
        // Use slotKey from backend response for consistency
        bookedSlotKey = booking.slotKey || slotKeyToSend;
        bookedSlotObj = {
          courseId: booking.courseId || booking.course_id,
          day: booking.day,
          time: booking.time,
          date: booking.date || '',
          bookingId: booking.id
        };
      } else {
        setBookedSlot(slot);
      }
      await refreshMyBookings();
      await loadSchedule();
      renderScheduleAvailability();
      findNextSession();
      render();
    })
    .catch(err=>{
      alert(err.message || 'Không thể giữ slot');
      closeSucc();
      updateBar();
    });
}
